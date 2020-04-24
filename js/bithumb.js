'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, ExchangeNotAvailable, AuthenticationError, BadRequest, PermissionDenied, InvalidAddress, ArgumentsRequired, InvalidOrder } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class bithumb extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'bithumb',
            'name': 'Bithumb',
            'countries': [ 'KR' ], // South Korea
            'rateLimit': 500,
            'has': {
                'CORS': true,
                'fetchTickers': true,
                'fetchOpenOrders': true,
                'fetchOrder': true,
                'withdraw': true,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/30597177-ea800172-9d5e-11e7-804c-b9d4fa9b56b0.jpg',
                'api': {
                    'public': 'https://api.bithumb.com/public',
                    'private': 'https://api.bithumb.com',
                },
                'www': 'https://www.bithumb.com',
                'doc': 'https://apidocs.bithumb.com',
                'fees': 'https://en.bithumb.com/customer_support/info_fee',
            },
            'api': {
                'public': {
                    'get': [
                        'ticker/{currency}',
                        'ticker/all',
                        'orderbook/{currency}',
                        'orderbook/all',
                        'transaction_history/{currency}',
                        'transaction_history/all',
                    ],
                },
                'private': {
                    'post': [
                        'info/account',
                        'info/balance',
                        'info/wallet_address',
                        'info/ticker',
                        'info/orders',
                        'info/user_transactions',
                        'info/order_detail',
                        'trade/place',
                        'trade/cancel',
                        'trade/btc_withdrawal',
                        'trade/krw_deposit',
                        'trade/krw_withdrawal',
                        'trade/market_buy',
                        'trade/market_sell',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'maker': 0.25 / 100,
                    'taker': 0.25 / 100,
                },
            },
            'exceptions': {
                'Bad Request(SSL)': BadRequest,
                'Bad Request(Bad Method)': BadRequest,
                'Bad Request.(Auth Data)': AuthenticationError, // { "status": "5100", "message": "Bad Request.(Auth Data)" }
                'Not Member': AuthenticationError,
                'Invalid Apikey': AuthenticationError, // {"status":"5300","message":"Invalid Apikey"}
                'Method Not Allowed.(Access IP)': PermissionDenied,
                'Method Not Allowed.(BTC Adress)': InvalidAddress,
                'Method Not Allowed.(Access)': PermissionDenied,
                'Database Fail': ExchangeNotAvailable,
                'Invalid Parameter': BadRequest,
                '5600': ExchangeError,
                'Unknown Error': ExchangeError,
                'After May 23th, recent_transactions is no longer, hence users will not be able to connect to recent_transactions': ExchangeError, // {"status":"5100","message":"After May 23th, recent_transactions is no longer, hence users will not be able to connect to recent_transactions"}
            },
        });
    }

    async fetchMarkets (params = {}) {
        const response = await this.publicGetTickerAll (params);
        const data = this.safeValue (response, 'data');
        const currencyIds = Object.keys (data);
        const result = [];
        for (let i = 0; i < currencyIds.length; i++) {
            const currencyId = currencyIds[i];
            if (currencyId === 'date') {
                continue;
            }
            const market = data[currencyId];
            const base = currencyId;
            const quote = 'KRW';
            const symbol = currencyId + '/' + quote;
            let active = true;
            if (Array.isArray (market)) {
                const numElements = market.length;
                if (numElements === 0) {
                    active = false;
                }
            }
            result.push ({
                'id': currencyId,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'info': market,
                'active': active,
                'precision': {
                    'amount': undefined,
                    'price': undefined,
                },
                'limits': {
                    'amount': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                },
                'baseId': undefined,
                'quoteId': undefined,
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        const request = {
            'currency': 'ALL',
        };
        const response = await this.privatePostInfoBalance (this.extend (request, params));
        const result = { 'info': response };
        const balances = this.safeValue (response, 'data');
        const codes = Object.keys (this.currencies);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            const account = this.account ();
            const currency = this.currency (code);
            const lowerCurrencyId = this.safeStringLower (currency, 'id');
            account['total'] = this.safeFloat (balances, 'total_' + lowerCurrencyId);
            account['used'] = this.safeFloat (balances, 'in_use_' + lowerCurrencyId);
            account['free'] = this.safeFloat (balances, 'available_' + lowerCurrencyId);
            result[code] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'currency': market['base'],
        };
        if (limit !== undefined) {
            request['count'] = limit; // default 30, max 30
        }
        const response = await this.publicGetOrderbookCurrency (this.extend (request, params));
        //
        //     {
        //         "status":"0000",
        //         "data":{
        //             "timestamp":"1587621553942",
        //             "payment_currency":"KRW",
        //             "order_currency":"BTC",
        //             "bids":[
        //                 {"price":"8652000","quantity":"0.0043"},
        //                 {"price":"8651000","quantity":"0.0049"},
        //                 {"price":"8650000","quantity":"8.4791"},
        //             ],
        //             "asks":[
        //                 {"price":"8654000","quantity":"0.119"},
        //                 {"price":"8655000","quantity":"0.254"},
        //                 {"price":"8658000","quantity":"0.119"},
        //             ]
        //         }
        //     }
        //
        const data = this.safeValue (response, 'data', {});
        const timestamp = this.safeInteger (data, 'timestamp');
        return this.parseOrderBook (data, timestamp, 'bids', 'asks', 'price', 'quantity');
    }

    parseTicker (ticker, market = undefined) {
        const timestamp = this.safeInteger (ticker, 'date');
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        const open = this.safeFloat (ticker, 'opening_price');
        const close = this.safeFloat (ticker, 'closing_price');
        let change = undefined;
        let percentage = undefined;
        let average = undefined;
        if ((close !== undefined) && (open !== undefined)) {
            change = close - open;
            if (open > 0) {
                percentage = change / open * 100;
            }
            average = this.sum (open, close) / 2;
        }
        const baseVolume = this.safeFloat (ticker, 'units_traded_24H');
        const quoteVolume = this.safeFloat (ticker, 'acc_trade_value_24H');
        let vwap = undefined;
        if (quoteVolume !== undefined && baseVolume !== undefined) {
            vwap = quoteVolume / baseVolume;
        }
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'max_price'),
            'low': this.safeFloat (ticker, 'min_price'),
            'bid': this.safeFloat (ticker, 'buy_price'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'sell_price'),
            'askVolume': undefined,
            'vwap': vwap,
            'open': open,
            'close': close,
            'last': close,
            'previousClose': undefined,
            'change': change,
            'percentage': percentage,
            'average': average,
            'baseVolume': baseVolume,
            'quoteVolume': quoteVolume,
            'info': ticker,
        };
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        const response = await this.publicGetTickerAll (params);
        const result = {};
        const timestamp = this.safeInteger (response['data'], 'date');
        const tickers = this.omit (response['data'], 'date');
        const ids = Object.keys (tickers);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            let symbol = id;
            let market = undefined;
            if (id in this.markets_by_id) {
                market = this.markets_by_id[id];
                symbol = market['symbol'];
            }
            const ticker = tickers[id];
            const isArray = Array.isArray (ticker);
            if (!isArray) {
                ticker['date'] = timestamp;
                result[symbol] = this.parseTicker (ticker, market);
            }
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'currency': market['base'],
        };
        const response = await this.publicGetTickerCurrency (this.extend (request, params));
        return this.parseTicker (response['data'], market);
    }

    parseTrade (trade, market = undefined) {
        //
        // fetchTrades (public)
        //
        //     {
        //         "transaction_date":"2020-04-23 22:21:46",
        //         "type":"ask",
        //         "units_traded":"0.0125",
        //         "price":"8667000",
        //         "total":"108337"
        //     }
        //
        // fetchOrder (private)
        //
        //     {
        //         "transaction_date": "1572497603902030",
        //         "price": "8601000",
        //         "units": "0.005",
        //         "fee_currency": "KRW",
        //         "fee": "107.51",
        //         "total": "43005"
        //     }
        //
        // a workaround for their bug in date format, hours are not 0-padded
        let timestamp = undefined;
        const transactionDatetime = this.safeString (trade, 'transaction_date');
        if (transactionDatetime !== undefined) {
            const parts = transactionDatetime.split (' ');
            const numParts = parts.length;
            if (numParts > 1) {
                const transactionDate = parts[0];
                let transactionTime = parts[1];
                if (transactionTime.length < 8) {
                    transactionTime = '0' + transactionTime;
                }
                timestamp = this.parse8601 (transactionDate + ' ' + transactionTime);
            } else {
                timestamp = this.safeIntegerProduct (trade, 'transaction_date', 0.001);
            }
        }
        if (timestamp !== undefined) {
            timestamp -= 9 * 3600000; // they report UTC + 9 hours, server in Korean timezone
        }
        const type = undefined;
        let side = this.safeString (trade, 'type');
        side = (side === 'ask') ? 'sell' : 'buy';
        const id = this.safeString (trade, 'cont_no');
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        const price = this.safeFloat (trade, 'price');
        const amount = this.safeFloat (trade, 'units_traded');
        let cost = this.safeFloat (trade, 'total');
        if (cost === undefined) {
            if (amount !== undefined) {
                if (price !== undefined) {
                    cost = price * amount;
                }
            }
        }
        let fee = undefined;
        const feeCost = this.safeFloat (trade, 'fee');
        if (feeCost !== undefined) {
            const feeCurrencyId = this.safeString (trade, 'fee_currency');
            const feeCurrencyCode = this.commonCurrencyCode (feeCurrencyId);
            fee = {
                'cost': feeCost,
                'currency': feeCurrencyCode,
            };
        }
        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'order': undefined,
            'type': type,
            'side': side,
            'takerOrMaker': undefined,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': fee,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'currency': market['base'],
        };
        if (limit === undefined) {
            request['count'] = limit; // default 20, max 100
        }
        const response = await this.publicGetTransactionHistoryCurrency (this.extend (request, params));
        //
        //     {
        //         "status":"0000",
        //         "data":[
        //             {
        //                 "transaction_date":"2020-04-23 22:21:46",
        //                 "type":"ask",
        //                 "units_traded":"0.0125",
        //                 "price":"8667000",
        //                 "total":"108337"
        //             },
        //         ]
        //     }
        //
        const data = this.safeValue (response, 'data', []);
        return this.parseTrades (data, market, since, limit);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
                'order_currency': market['id'],
                'Payment_currency': market['quote'],
                'units': amount,
                'type': (side === 'buy') ? 'bid' : 'ask',
        };
        let method = 'privatePostTradePlace';
        if (type === 'limit') {
            request['price'] = price;
        } else {
            method = 'privatePostTradeMarket' + this.capitalize (side);
        }
        const response = await this[method] (this.extend (request, params));
        const id = this.safeString (response, 'order_id');
        if (id === undefined) {
            throw new InvalidOrder (this.id + ' createOrder did not return an order id');
        }
        return {
            'info': response,
            'symbol': symbol,
            'type': type,
            'side': side,
            'id': id,
        };
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrder requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'order_id': id,
            'count': 1,
            'order_currency': market['base'],
            'payment_currency': market['quote'],
        };
        const response = await this.privatePostInfoOrderDetail (this.extend (request, params));
        //
        //     {
        //         "status": "0000",
        //         "data": {
        //             "transaction_date": "1572497603668315",
        //             "type": "bid",
        //             "order_status": "Completed",
        //             "order_currency": "BTC",
        //             "payment_currency": "KRW",
        //             "order_price": "8601000",
        //             "order_qty": "0.007",
        //             "cancel_date": "",
        //             "cancel_type": "",
        //             "contract": [
        //                 {
        //                     "transaction_date": "1572497603902030",
        //                     "price": "8601000",
        //                     "units": "0.005",
        //                     "fee_currency": "KRW",
        //                     "fee": "107.51",
        //                     "total": "43005"
        //                 },
        //             ]
        //         }
        //     }
        //
        const data = this.safeValue (response, 'data');
        return this.parseOrder (this.extend (data, { 'order_id': id }), market);
    }

    parseOrderStatus (status) {
        const statuses = {
            'Pending': 'open',
            'Completed': 'closed',
            'Cancel': 'canceled',
        };
        return this.safeString (statuses, status, status);
    }

    parseOrder (order, market = undefined) {
        //
        // fetchOrder
        //
        //     {
        //         "transaction_date": "1572497603668315",
        //         "type": "bid",
        //         "order_status": "Completed",
        //         "order_currency": "BTC",
        //         "payment_currency": "KRW",
        //         "order_price": "8601000",
        //         "order_qty": "0.007",
        //         "cancel_date": "",
        //         "cancel_type": "",
        //         "contract": [
        //             {
        //                 "transaction_date": "1572497603902030",
        //                 "price": "8601000",
        //                 "units": "0.005",
        //                 "fee_currency": "KRW",
        //                 "fee": "107.51",
        //                 "total": "43005"
        //             },
        //         ]
        //     }
        //
        // fetchOpenOrders
        //
        //     {
        //         "order_currency": "BTC",
        //         "payment_currency": "KRW",
        //         "order_id": "C0101000007408440032",
        //         "order_date": "1571728739360570",
        //         "type": "bid",
        //         "units": "5.0",
        //         "units_remaining": "5.0",
        //         "price": "501000",
        //     }
        //
        const timestamp = this.safeIntegerProduct (order, 'order_date', 0.001);
        const sideProperty = this.safeValue2 (order, 'type', 'side');
        const side = (sideProperty === 'bid') ? 'buy' : 'sell';
        const status = this.parseOrderStatus (this.safeString (order, 'order_status'));
        let price = this.safeFloat2 (order, 'order_price', 'price');
        let type = 'limit';
        if (price === 0) {
            price = undefined;
            type = 'market';
        }
        const amount = this.safeFloat2 (order, 'order_qty', 'units');
        let remaining = this.safeFloat (order, 'units_remaining');
        if (remaining === undefined) {
            if (status === 'closed') {
                remaining = 0;
            } else {
                remaining = amount;
            }
        }
        let filled = undefined;
        if ((amount !== undefined) && (remaining !== undefined)) {
            filled = amount - remaining;
        }
        let symbol = undefined;
        const baseId = this.safeString (order, 'order_currency');
        const quoteId = this.safeString (order, 'payment_currency');
        const base = this.safeCurrencyCode (baseId);
        const quote = this.safeCurrencyCode (quoteId);
        if ((base !== undefined) && (quote !== undefined)) {
            symbol = base + '/' + quote;
        }
        if ((symbol === undefined) && (market !== undefined)) {
            symbol = market['symbol'];
        }
        const rawTrades = this.safeValue (order, 'contract');
        let trades = undefined;
        const id = this.safeString (order, 'order_id');
        if (rawTrades !== undefined) {
            trades = this.parseTrades (rawTrades, market, undefined, undefined, {
                'side': side,
                'symbol': symbol,
                'order': id,
            });
        }
        return {
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'average': undefined,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': undefined,
            'trades': trades,
        };
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOpenOrders requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        if (limit === undefined) {
            limit = 100;
        }
        const request = {
            'count': limit,
            'order_currency': market['base'],
            'payment_currency': market['quote'],
        };
        if (since !== undefined) {
            request['after'] = since;
        }
        const response = await this.privatePostInfoOrders (this.extend (request, params));
        //
        //     {
        //         "status": "0000",
        //         "data": [
        //             {
        //                 "order_currency": "BTC",
        //                 "payment_currency": "KRW",
        //                 "order_id": "C0101000007408440032",
        //                 "order_date": "1571728739360570",
        //                 "type": "bid",
        //                 "units": "5.0",
        //                 "units_remaining": "5.0",
        //                 "price": "501000",
        //             }
        //         ]
        //     }
        //
        const data = this.safeValue (response, 'data', []);
        return this.parseOrders (data, market, since, limit);
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        const side_in_params = ('side' in params);
        if (!side_in_params) {
            throw new ArgumentsRequired (this.id + ' cancelOrder requires a `symbol` argument and a `side` parameter (sell or buy)');
        }
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelOrder requires a `symbol` argument and a `side` parameter (sell or buy)');
        }
        const market = this.market (symbol);
        const side = (params['side'] === 'buy') ? 'bid' : 'ask';
        params = this.omit (params, [ 'side', 'currency' ]);
        // https://github.com/ccxt/ccxt/issues/6771
        const request = {
            'order_id': id,
            'type': side,
            'order_currency': market['base'],
            'payment_currency': market['quote'],
        };
        return await this.privatePostTradeCancel (this.extend (request, params));
    }

    async withdraw (code, amount, address, tag = undefined, params = {}) {
        this.checkAddress (address);
        await this.loadMarkets ();
        const currency = this.currency (code);
        const request = {
            'units': amount,
            'address': address,
            'currency': currency['id'],
        };
        if (currency === 'XRP' || currency === 'XMR') {
            const destination = this.safeString (params, 'destination');
            if ((tag === undefined) && (destination === undefined)) {
                throw new ArgumentsRequired (this.id + ' ' + code + ' withdraw() requires a tag argument or an extra destination param');
            } else if (tag !== undefined) {
                request['destination'] = tag;
            }
        }
        const response = await this.privatePostTradeBtcWithdrawal (this.extend (request, params));
        return {
            'info': response,
            'id': undefined,
        };
    }

    nonce () {
        return this.milliseconds ();
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        const endpoint = '/' + this.implodeParams (path, params);
        let url = this.urls['api'][api] + endpoint;
        const query = this.omit (params, this.extractParams (path));
        if (api === 'public') {
            if (Object.keys (query).length) {
                url += '?' + this.urlencode (query);
            }
        } else {
            this.checkRequiredCredentials ();
            body = this.urlencode (this.extend ({
                'endpoint': endpoint,
            }, query));
            const nonce = this.nonce ().toString ();
            const auth = endpoint + "\0" + body + "\0" + nonce; // eslint-disable-line quotes
            const signature = this.hmac (this.encode (auth), this.encode (this.secret), 'sha512');
            const signature64 = this.decode (this.stringToBase64 (this.encode (signature)));
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Api-Key': this.apiKey,
                'Api-Sign': signature64.toString (),
                'Api-Nonce': nonce,
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (httpCode, reason, url, method, headers, body, response, requestHeaders, requestBody) {
        if (response === undefined) {
            return; // fallback to default error handler
        }
        if ('status' in response) {
            //
            //     {"status":"5100","message":"After May 23th, recent_transactions is no longer, hence users will not be able to connect to recent_transactions"}
            //
            const status = this.safeString (response, 'status');
            const message = this.safeString (response, 'message');
            if (status !== undefined) {
                if (status === '0000') {
                    return; // no error
                }
                const feedback = this.id + ' ' + body;
                this.throwExactlyMatchedException (this.exceptions, status, feedback);
                this.throwExactlyMatchedException (this.exceptions, message, feedback);
                throw new ExchangeError (feedback);
            }
        }
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        const response = await this.fetch2 (path, api, method, params, headers, body);
        if ('status' in response) {
            if (response['status'] === '0000') {
                return response;
            }
            throw new ExchangeError (this.id + ' ' + this.json (response));
        }
        return response;
    }
};
