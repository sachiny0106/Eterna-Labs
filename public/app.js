// simple state
var timePeriod = '1h';
var sortBy = 'volume';
var searchQuery = '';
var cursor = null;
var nextCursor = null;
var prevCursor = null;
var hasMore = false;
var totalCount = 0;
var tokens = [];
var socket = null;

// dom refs
var tbody = document.getElementById('tokens');
var searchInput = document.getElementById('search');
var sortSelect = document.getElementById('sort');
var refreshBtn = document.getElementById('refresh');
var prevBtn = document.getElementById('prev');
var nextBtn = document.getElementById('next');
var pageInfo = document.getElementById('page-info');
var totalEl = document.getElementById('total');
var solEl = document.getElementById('sol-price');
var updatedEl = document.getElementById('updated');
var statusEl = document.getElementById('status');
var timeBtns = document.querySelectorAll('.time-btn');

// load tokens
function loadTokens() {
    var url = '/api/tokens?time_period=' + timePeriod + '&sort_by=' + sortBy + '&limit=25';
    if (searchQuery) url += '&search=' + encodeURIComponent(searchQuery);
    if (cursor) url += '&cursor=' + cursor;
    
    tbody.innerHTML = '<tr><td colspan="7" class="center">Loading...</td></tr>';
    
    fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (res.success && res.data) {
                tokens = res.data.data;
                nextCursor = res.data.pagination.next_cursor;
                prevCursor = res.data.pagination.prev_cursor;
                hasMore = res.data.pagination.has_more;
                totalCount = res.data.pagination.total_count;
                render();
            }
        })
        .catch(function(e) {
            console.log('error', e);
            tbody.innerHTML = '<tr><td colspan="7" class="center">Failed to load</td></tr>';
        });
}

// render table
function render() {
    if (tokens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="center">No tokens found</td></tr>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        var change = getChange(t);
        var vol = getVolume(t);
        var changeClass = change >= 0 ? 'green' : 'red';
        var sign = change >= 0 ? '+' : '';
        
        html += '<tr data-addr="' + t.token_address + '">';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td><span class="token-name">' + esc(t.token_name || 'Unknown') + '</span><br><span class="token-symbol">' + esc(t.token_ticker || '-') + '</span></td>';
        html += '<td>' + fmtPrice(t.price_usd) + '</td>';
        html += '<td class="' + changeClass + '">' + sign + change.toFixed(2) + '%</td>';
        html += '<td>' + fmtNum(vol) + '</td>';
        html += '<td>' + fmtNum(t.market_cap_usd) + '</td>';
        html += '<td>' + fmtNum(t.liquidity_usd) + '</td>';
        html += '</tr>';
    }
    
    tbody.innerHTML = html;
    totalEl.textContent = totalCount;
    updatedEl.textContent = new Date().toLocaleTimeString();
    updatePagination();
}

function getChange(t) {
    if (timePeriod === '1h') return t.price_1hr_change || 0;
    if (timePeriod === '7d') return t.price_7d_change || 0;
    return t.price_24hr_change || 0;
}

function getVolume(t) {
    if (timePeriod === '1h') return t.volume_1hr || t.volume_usd || 0;
    if (timePeriod === '7d') return t.volume_7d || t.volume_usd || 0;
    return t.volume_24hr || t.volume_usd || 0;
}

function fmtPrice(p) {
    if (!p) return '$0';
    if (p < 0.0001) return '$' + p.toExponential(2);
    if (p < 1) return '$' + p.toFixed(6);
    return '$' + p.toFixed(2);
}

function fmtNum(n) {
    if (!n) return '-';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
}

function esc(s) {
    if (!s) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function updatePagination() {
    prevBtn.disabled = !prevCursor;
    nextBtn.disabled = !hasMore;
    pageInfo.textContent = tokens.length + ' of ' + totalCount;
}

// fetch sol price
function fetchStats() {
    fetch('/api/health/stats')
        .then(function(r) { return r.json(); })
        .then(function(res) {
            if (res.success && res.data && res.data.aggregator) {
                solEl.textContent = '$' + res.data.aggregator.sol_price.toFixed(2);
            }
        })
        .catch(function() {});
}

// websocket
function connectWS() {
    try {
        socket = io();
        
        socket.on('connect', function() {
            statusEl.textContent = '● Live';
            statusEl.className = 'online';
        });
        
        socket.on('disconnect', function() {
            statusEl.textContent = '● Offline';
            statusEl.className = 'offline';
        });
        
        socket.on('price_update', function(msg) {
            if (!msg || !msg.data) return;
            var row = document.querySelector('tr[data-addr="' + msg.data.token_address + '"]');
            if (row) {
                row.classList.remove('flash-green', 'flash-red');
                void row.offsetWidth;
                row.classList.add(msg.data.price_change_percent > 0 ? 'flash-green' : 'flash-red');
            }
        });
        
        socket.on('batch_update', function() {
            updatedEl.textContent = new Date().toLocaleTimeString();
        });
    } catch (e) {
        console.log('ws error', e);
    }
}

// events
for (var i = 0; i < timeBtns.length; i++) {
    timeBtns[i].onclick = function(e) {
        for (var j = 0; j < timeBtns.length; j++) {
            timeBtns[j].classList.remove('active');
        }
        e.target.classList.add('active');
        timePeriod = e.target.dataset.period;
        cursor = null;
        loadTokens();
    };
}

sortSelect.onchange = function() {
    sortBy = sortSelect.value;
    cursor = null;
    loadTokens();
};

var searchTimer;
searchInput.oninput = function() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
        searchQuery = searchInput.value;
        cursor = null;
        loadTokens();
    }, 300);
};

refreshBtn.onclick = function() {
    cursor = null;
    loadTokens();
    fetchStats();
};

prevBtn.onclick = function() {
    if (prevCursor) {
        cursor = prevCursor;
        loadTokens();
    }
};

nextBtn.onclick = function() {
    if (nextCursor) {
        cursor = nextCursor;
        loadTokens();
    }
};

// init
loadTokens();
fetchStats();
connectWS();
setInterval(fetchStats, 30000);
