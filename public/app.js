// app.js - frontend for meme coin aggregator

// keep track of state
var state = {
    tokens: [],
    timePeriod: '1h',
    sortBy: 'volume',
    sortDir: 'desc',
    search: '',
    cursor: null,
    nextCursor: null,
    prevCursor: null,
    hasMore: false,
    totalCount: 0,
    socket: null
};

// grab dom elements
var tokenTableBody = document.getElementById('tokenTableBody');
var searchInput = document.getElementById('searchInput');
var sortSelect = document.getElementById('sortSelect');
var refreshBtn = document.getElementById('refreshBtn');
var prevBtn = document.getElementById('prevBtn');
var nextBtn = document.getElementById('nextBtn');
var pageInfo = document.getElementById('pageInfo');
var totalTokensEl = document.getElementById('totalTokens');
var solPriceEl = document.getElementById('solPrice');
var lastUpdateEl = document.getElementById('lastUpdate');
var connectionStatus = document.getElementById('connectionStatus');
var timeButtons = document.querySelectorAll('.time-btn');

// fetch tokens from backend
function fetchTokens() {
    var params = new URLSearchParams();
    params.set('time_period', state.timePeriod);
    params.set('sort_by', state.sortBy);
    params.set('sort_dir', state.sortDir);
    params.set('limit', '30');

    if (state.search) {
        params.set('search', state.search);
    }
    if (state.cursor) {
        params.set('cursor', state.cursor);
    }

    tokenTableBody.innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';

    fetch('/api/tokens?' + params.toString())
        .then(function (res) {
            return res.json();
        })
        .then(function (json) {
            if (json.success && json.data) {
                state.tokens = json.data.data;
                state.nextCursor = json.data.pagination.next_cursor;
                state.prevCursor = json.data.pagination.prev_cursor;
                state.hasMore = json.data.pagination.has_more;
                state.totalCount = json.data.pagination.total_count;
                renderTokens();
                updateStats();
            }
        })
        .catch(function (err) {
            console.error('Failed to fetch:', err);
            tokenTableBody.innerHTML = '<tr><td colspan="7" class="loading">Error loading tokens</td></tr>';
        });
}

// render token rows
function renderTokens() {
    if (state.tokens.length === 0) {
        tokenTableBody.innerHTML = '<tr><td colspan="7" class="loading">No tokens found</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < state.tokens.length; i++) {
        var t = state.tokens[i];
        var change = getChange(t);
        var volume = getVolume(t);

        html += '<tr data-addr="' + t.token_address + '">';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td><div class="token-info">';
        html += '<span class="token-name">' + esc(t.token_name) + '</span>';
        html += '<span class="token-ticker">' + esc(t.token_ticker) + '</span>';
        html += '</div></td>';
        html += '<td>' + fmtPrice(t.price_usd) + '</td>';
        html += '<td class="' + (change >= 0 ? 'positive' : 'negative') + '">';
        html += (change >= 0 ? '+' : '') + change.toFixed(2) + '%</td>';
        html += '<td>' + fmtNum(volume) + '</td>';
        html += '<td>' + fmtNum(t.market_cap_usd) + '</td>';
        html += '<td>' + fmtNum(t.liquidity_usd) + '</td>';
        html += '</tr>';
    }

    tokenTableBody.innerHTML = html;
    updatePagination();
}

// get price change based on time period
function getChange(t) {
    if (state.timePeriod === '1h') return t.price_1hr_change || 0;
    if (state.timePeriod === '7d') return t.price_7d_change || 0;
    return t.price_24hr_change || 0;
}

// get volume based on time period
function getVolume(t) {
    if (state.timePeriod === '1h') return t.volume_1hr || t.volume_usd || 0;
    if (state.timePeriod === '7d') return t.volume_7d || t.volume_usd || 0;
    return t.volume_24hr || t.volume_usd || 0;
}

// format price nicely
function fmtPrice(p) {
    if (!p) return '$0';
    if (p < 0.0001) return '$' + p.toExponential(2);
    if (p < 1) return '$' + p.toFixed(6);
    return '$' + p.toFixed(2);
}

// format big numbers with K/M/B
function fmtNum(n) {
    if (!n) return '$0';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
}

// escape html to prevent xss
function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// update stats bar
function updateStats() {
    totalTokensEl.textContent = state.totalCount;
    lastUpdateEl.textContent = new Date().toLocaleTimeString();
}

// update pagination buttons
function updatePagination() {
    prevBtn.disabled = !state.prevCursor;
    nextBtn.disabled = !state.hasMore;
    pageInfo.textContent = 'Showing ' + state.tokens.length + ' of ' + state.totalCount;
}

// connect to websocket for live updates
function connectWS() {
    try {
        state.socket = io(window.location.origin);

        state.socket.on('connect', function () {
            connectionStatus.className = 'status connected';
            connectionStatus.textContent = 'Live';
            console.log('WS connected');
        });

        state.socket.on('disconnect', function () {
            connectionStatus.className = 'status disconnected';
            connectionStatus.textContent = 'Disconnected';
            console.log('WS disconnected');
        });

        // handle price updates - flash the row
        state.socket.on('price_update', function (msg) {
            if (msg && msg.data) {
                var addr = msg.data.token_address;
                var row = document.querySelector('tr[data-addr="' + addr + '"]');
                if (row) {
                    row.classList.remove('flash-up', 'flash-down');
                    void row.offsetWidth; // force reflow
                    row.classList.add(msg.data.price_change_percent > 0 ? 'flash-up' : 'flash-down');
                }
            }
        });

        // batch updates just update the timestamp
        state.socket.on('batch_update', function () {
            lastUpdateEl.textContent = new Date().toLocaleTimeString();
        });

    } catch (e) {
        console.error('WS error:', e);
    }
}

// get health/stats for sol price
function fetchHealth() {
    fetch('/api/health/stats')
        .then(function (res) { return res.json(); })
        .then(function (json) {
            if (json.success && json.data && json.data.aggregator) {
                solPriceEl.textContent = '$' + json.data.aggregator.sol_price.toFixed(2);
            }
        })
        .catch(function (e) {
            console.error('Health fetch error:', e);
        });
}

// set up event listeners
function setupEvents() {
    // time period buttons
    for (var i = 0; i < timeButtons.length; i++) {
        timeButtons[i].addEventListener('click', function (e) {
            // remove active from all
            for (var j = 0; j < timeButtons.length; j++) {
                timeButtons[j].classList.remove('active');
            }
            e.target.classList.add('active');
            state.timePeriod = e.target.dataset.period;
            state.cursor = null;
            fetchTokens();
        });
    }

    // sort dropdown
    sortSelect.addEventListener('change', function (e) {
        state.sortBy = e.target.value;
        state.cursor = null;
        fetchTokens();
    });

    // search input with debounce
    var searchTimer = null;
    searchInput.addEventListener('input', function (e) {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            state.search = e.target.value;
            state.cursor = null;
            fetchTokens();
        }, 300);
    });

    // refresh button
    refreshBtn.addEventListener('click', function () {
        state.cursor = null;
        fetchTokens();
        fetchHealth();
    });

    // pagination
    prevBtn.addEventListener('click', function () {
        if (state.prevCursor) {
            state.cursor = state.prevCursor;
            fetchTokens();
        }
    });

    nextBtn.addEventListener('click', function () {
        if (state.nextCursor) {
            state.cursor = state.nextCursor;
            fetchTokens();
        }
    });
}

// init on page load
document.addEventListener('DOMContentLoaded', function () {
    setupEvents();
    fetchTokens();
    fetchHealth();
    connectWS();

    // refresh sol price every 30s
    setInterval(fetchHealth, 30000);
});
