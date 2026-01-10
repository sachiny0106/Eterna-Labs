// Meme Coin Aggregator - Frontend
// Simple vanilla JS, no frameworks needed for this

(function() {
    'use strict';

    // State management
    var state = {
        tokens: [],
        timePeriod: '1h',
        sortBy: 'volume',
        sortDir: 'desc',
        search: '',
        filter: null, // trending, gainers, losers, new
        cursor: null,
        nextCursor: null,
        prevCursor: null,
        hasMore: false,
        totalCount: 0,
        socket: null,
        isLoading: false
    };

    // DOM elements - grabbed once on load
    var elements = {};

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        grabElements();
        bindEvents();
        fetchTokens();
        fetchStats();
        connectWebSocket();
        
        // Auto-refresh stats every 30 seconds
        setInterval(fetchStats, 30000);
    }

    function grabElements() {
        elements.tokenTableBody = document.getElementById('tokenTableBody');
        elements.searchInput = document.getElementById('searchInput');
        elements.sortSelect = document.getElementById('sortSelect');
        elements.refreshBtn = document.getElementById('refreshBtn');
        elements.prevBtn = document.getElementById('prevBtn');
        elements.nextBtn = document.getElementById('nextBtn');
        elements.pageInfo = document.getElementById('pageInfo');
        elements.totalTokens = document.getElementById('totalTokens');
        elements.solPrice = document.getElementById('solPrice');
        elements.lastUpdate = document.getElementById('lastUpdate');
        elements.connectionStatus = document.getElementById('connectionStatus');
        elements.timeTabs = document.querySelectorAll('.time-tab');
        elements.quickCards = document.querySelectorAll('.quick-stat-card');
    }

    function bindEvents() {
        // Time period tabs
        elements.timeTabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                elements.timeTabs.forEach(function(t) { t.classList.remove('active'); });
                tab.classList.add('active');
                state.timePeriod = tab.dataset.period;
                state.cursor = null;
                state.filter = null;
                clearQuickCardActive();
                fetchTokens();
            });
        });

        // Quick filter cards
        elements.quickCards.forEach(function(card) {
            card.addEventListener('click', function(e) {
                e.preventDefault();
                var filter = card.dataset.filter;
                
                if (state.filter === filter) {
                    // Toggle off
                    state.filter = null;
                    card.classList.remove('active');
                } else {
                    clearQuickCardActive();
                    state.filter = filter;
                    card.classList.add('active');
                }
                
                state.cursor = null;
                fetchTokens();
            });
        });

        // Sort dropdown
        elements.sortSelect.addEventListener('change', function() {
            state.sortBy = this.value;
            state.cursor = null;
            fetchTokens();
        });

        // Search with debounce
        var searchTimer;
        elements.searchInput.addEventListener('input', function() {
            clearTimeout(searchTimer);
            var val = this.value;
            searchTimer = setTimeout(function() {
                state.search = val;
                state.cursor = null;
                fetchTokens();
            }, 300);
        });

        // Refresh button
        elements.refreshBtn.addEventListener('click', function() {
            state.cursor = null;
            fetchTokens();
            fetchStats();
        });

        // Pagination
        elements.prevBtn.addEventListener('click', function() {
            if (state.prevCursor) {
                state.cursor = state.prevCursor;
                fetchTokens();
            }
        });

        elements.nextBtn.addEventListener('click', function() {
            if (state.nextCursor) {
                state.cursor = state.nextCursor;
                fetchTokens();
            }
        });

        // Keyboard shortcut for search (Cmd/Ctrl + K)
        document.addEventListener('keydown', function(e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                elements.searchInput.focus();
            }
        });
    }

    function clearQuickCardActive() {
        elements.quickCards.forEach(function(c) { c.classList.remove('active'); });
    }

    // Fetch tokens from API
    function fetchTokens() {
        if (state.isLoading) return;
        state.isLoading = true;

        elements.refreshBtn.classList.add('loading');
        showLoading();

        var endpoint = '/api/tokens';
        var params = new URLSearchParams();

        // Check for special filters first
        if (state.filter === 'trending') {
            endpoint = '/api/tokens/trending';
        } else if (state.filter === 'gainers') {
            endpoint = '/api/tokens/gainers';
        } else if (state.filter === 'losers') {
            endpoint = '/api/tokens/losers';
        } else {
            // Normal fetch with filters
            params.set('time_period', state.timePeriod);
            params.set('sort_by', state.sortBy);
            params.set('sort_dir', state.sortDir);
            params.set('limit', '25');

            if (state.search) {
                params.set('search', state.search);
            }
            if (state.cursor) {
                params.set('cursor', state.cursor);
            }
        }

        var url = endpoint;
        if (params.toString()) {
            url += '?' + params.toString();
        }

        fetch(url)
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json.success && json.data) {
                    // Handle array or object response
                    if (Array.isArray(json.data)) {
                        state.tokens = json.data;
                        state.totalCount = json.data.length;
                        state.hasMore = false;
                        state.nextCursor = null;
                        state.prevCursor = null;
                    } else {
                        state.tokens = json.data.data || [];
                        state.nextCursor = json.data.pagination?.next_cursor || null;
                        state.prevCursor = json.data.pagination?.prev_cursor || null;
                        state.hasMore = json.data.pagination?.has_more || false;
                        state.totalCount = json.data.pagination?.total_count || state.tokens.length;
                    }
                    renderTokens();
                    updatePagination();
                } else {
                    showError('Failed to load tokens');
                }
            })
            .catch(function(err) {
                console.error('Fetch error:', err);
                showError('Error loading data');
            })
            .finally(function() {
                state.isLoading = false;
                elements.refreshBtn.classList.remove('loading');
            });
    }

    // Render token table
    function renderTokens() {
        if (state.tokens.length === 0) {
            elements.tokenTableBody.innerHTML = 
                '<tr><td colspan="8" class="empty-cell">' +
                '<div class="empty-icon">🔍</div>' +
                '<div>No tokens found</div>' +
                '</td></tr>';
            return;
        }

        var html = '';
        state.tokens.forEach(function(t, i) {
            var change = getChange(t);
            var volume = getVolume(t);
            var changeClass = change >= 0 ? 'positive' : 'negative';
            var changeSign = change >= 0 ? '+' : '';
            var initial = (t.token_ticker || t.token_name || '?').charAt(0).toUpperCase();
            
            // Try to get image or show initial
            var iconHtml = '<span>' + escapeHtml(initial) + '</span>';
            if (t.image_url) {
                iconHtml = '<img src="' + escapeHtml(t.image_url) + '" alt="" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'"><span style="display:none">' + escapeHtml(initial) + '</span>';
            }

            html += '<tr data-addr="' + escapeHtml(t.token_address) + '">';
            html += '<td class="rank-cell">' + (i + 1) + '</td>';
            html += '<td><div class="token-cell">';
            html += '<div class="token-icon">' + iconHtml + '</div>';
            html += '<div class="token-details">';
            html += '<span class="token-name">' + escapeHtml(t.token_name || 'Unknown') + '</span>';
            html += '<span class="token-ticker">' + escapeHtml(t.token_ticker || '-') + '</span>';
            html += '</div></div></td>';
            html += '<td class="price-cell">' + formatPrice(t.price_usd) + '</td>';
            html += '<td><span class="change-cell ' + changeClass + '">' + changeSign + change.toFixed(2) + '%</span></td>';
            html += '<td class="num-cell col-volume">' + formatNumber(volume) + '</td>';
            html += '<td class="num-cell col-mcap">' + formatNumber(t.market_cap_usd) + '</td>';
            html += '<td class="num-cell col-liquidity">' + formatNumber(t.liquidity_usd) + '</td>';
            html += '<td class="txns-cell col-txns">';
            if (t.txns_24hr) {
                html += '<span class="txns-buy">' + formatCompact(t.txns_24hr.buys || 0) + '</span>/';
                html += '<span class="txns-sell">' + formatCompact(t.txns_24hr.sells || 0) + '</span>';
            } else {
                html += '-';
            }
            html += '</td>';
            html += '</tr>';
        });

        elements.tokenTableBody.innerHTML = html;
        elements.totalTokens.textContent = formatCompact(state.totalCount);
        elements.lastUpdate.textContent = new Date().toLocaleTimeString();
    }

    // Get price change based on selected time period
    function getChange(t) {
        if (state.timePeriod === '1h') return t.price_1hr_change || 0;
        if (state.timePeriod === '7d') return t.price_7d_change || 0;
        return t.price_24hr_change || 0;
    }

    // Get volume based on selected time period
    function getVolume(t) {
        if (state.timePeriod === '1h') return t.volume_1hr || t.volume_usd || 0;
        if (state.timePeriod === '7d') return t.volume_7d || t.volume_usd || 0;
        return t.volume_24hr || t.volume_usd || 0;
    }

    // Format price for display
    function formatPrice(p) {
        if (!p || p === 0) return '$0.00';
        if (p < 0.000001) return '$' + p.toExponential(2);
        if (p < 0.0001) return '$' + p.toFixed(8);
        if (p < 0.01) return '$' + p.toFixed(6);
        if (p < 1) return '$' + p.toFixed(4);
        return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Format large numbers
    function formatNumber(n) {
        if (!n || n === 0) return '-';
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
        return '$' + n.toFixed(0);
    }

    // Compact number format
    function formatCompact(n) {
        if (!n) return '0';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    // Escape HTML to prevent XSS
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Show loading state
    function showLoading() {
        elements.tokenTableBody.innerHTML = 
            '<tr><td colspan="8" class="loading-cell">' +
            '<div class="loader-container">' +
            '<div class="loader"></div>' +
            '<span>Loading tokens...</span>' +
            '</div></td></tr>';
    }

    // Show error state
    function showError(msg) {
        elements.tokenTableBody.innerHTML = 
            '<tr><td colspan="8" class="empty-cell">' +
            '<div class="empty-icon">⚠️</div>' +
            '<div>' + escapeHtml(msg) + '</div>' +
            '</td></tr>';
    }

    // Update pagination buttons
    function updatePagination() {
        elements.prevBtn.disabled = !state.prevCursor;
        elements.nextBtn.disabled = !state.hasMore;
        
        var showing = state.tokens.length;
        var total = state.totalCount;
        elements.pageInfo.textContent = 'Showing ' + showing + ' of ' + formatCompact(total);
    }

    // Fetch health stats (SOL price)
    function fetchStats() {
        fetch('/api/health/stats')
            .then(function(res) { return res.json(); })
            .then(function(json) {
                if (json.success && json.data && json.data.aggregator) {
                    var solPrice = json.data.aggregator.sol_price;
                    if (solPrice) {
                        elements.solPrice.textContent = '$' + solPrice.toFixed(2);
                    }
                }
            })
            .catch(function(err) {
                console.error('Stats fetch error:', err);
            });
    }

    // WebSocket connection for real-time updates
    function connectWebSocket() {
        try {
            state.socket = io(window.location.origin, {
                transports: ['websocket', 'polling']
            });

            state.socket.on('connect', function() {
                updateConnectionStatus(true);
                console.log('[WS] Connected');
            });

            state.socket.on('disconnect', function() {
                updateConnectionStatus(false);
                console.log('[WS] Disconnected');
            });

            state.socket.on('connect_error', function() {
                updateConnectionStatus(false);
            });

            // Handle price updates - flash the row
            state.socket.on('price_update', function(msg) {
                if (!msg || !msg.data) return;
                var addr = msg.data.token_address;
                var row = document.querySelector('tr[data-addr="' + addr + '"]');
                if (row) {
                    row.classList.remove('flash-up', 'flash-down');
                    void row.offsetWidth; // Force reflow
                    var isUp = (msg.data.price_change_percent || 0) > 0;
                    row.classList.add(isUp ? 'flash-up' : 'flash-down');
                }
            });

            // Batch updates - just update timestamp
            state.socket.on('batch_update', function() {
                elements.lastUpdate.textContent = new Date().toLocaleTimeString();
            });

        } catch (err) {
            console.error('[WS] Error:', err);
            updateConnectionStatus(false);
        }
    }

    function updateConnectionStatus(connected) {
        var statusEl = elements.connectionStatus;
        var textEl = statusEl.querySelector('.status-text');
        
        if (connected) {
            statusEl.classList.remove('disconnected');
            statusEl.classList.add('connected');
            textEl.textContent = 'Live';
        } else {
            statusEl.classList.remove('connected');
            statusEl.classList.add('disconnected');
            textEl.textContent = 'Offline';
        }
    }

})();
