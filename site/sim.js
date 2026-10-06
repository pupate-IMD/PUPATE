// Prototype behaviour. Everything below simulates the contracts in the page: the same rules as
// Cocoon and PupateHook, run against sample figures, so the flows can be judged before anything is
// deployed. Nothing here sends a transaction. The live site replaces this file with contract reads
// and writes through the visitor's wallet.
(function () {
  var root = document.documentElement;
  var byId = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ theme
  var themeBtn = byId('theme');
  function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function effectiveDark() { var t = root.getAttribute('data-theme'); return t ? t === 'dark' : systemDark(); }
  function labelTheme() { themeBtn.textContent = effectiveDark() ? 'Switch to light' : 'Switch to dark'; }
  function applyTheme(t, remember) {
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    if (remember) { try { localStorage.setItem('pupate-theme', t || ''); } catch (e) {} }
    labelTheme();
  }
  var hash = (location.hash || '').replace('#', '');
  if (hash === 'light' || hash === 'dark') {
    applyTheme(hash, false);
  } else {
    var saved = null;
    try { saved = localStorage.getItem('pupate-theme'); } catch (e) {}
    applyTheme(saved === 'light' || saved === 'dark' ? saved : null, false);
  }
  themeBtn.addEventListener('click', function () { applyTheme(effectiveDark() ? 'light' : 'dark', true); });
  if (window.matchMedia) { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', labelTheme); }

  // ------------------------------------------------------------------ the simulated world
  var RATE = 70400000;          // PUPATE per ETH at the pool price (sample)
  var LP = 0.003;
  var STANDING_TAX = 0.06;
  var REWARD = 0.005;
  var IMPACT_CAP_ETH = 0.3;     // what a 5% price-impact limit lets one burn spend at this pool depth (sample)
  var HALF_LIFE_H = 2;

  function seat(id, cost, day, jobs, status) { return { id: id, cost: cost, day: day, jobs: jobs, status: status }; }

  var PRESETS = {
    steady: function () {
      return {
        launch: false, launchMinute: 0, day: 23, floor: 2.74,
        taxCollected: 61.2, hookWaiting: 0.08, seatPot: 1.95, burnPot: 0.41, dev: 6.12, imdBurn: 3.06,
        burned: 12480000, imdBurned: 312, harvested: 0.37,
        seats: [seat(1733, 2.84, 0, 3, 'working'), seat(882, 2.76, 2, 17, 'working'), seat(1376, 2.80, 6, 41, 'working'),
                seat(410, 2.72, 9, 0, 'idle'), seat(1540, 2.91, 11, 66, 'working'), seat(97, 2.66, 14, 88, 'working')],
        sold: [{ id: 231, bought: 2.58, sold: 3.41, held: 5, burned: 4310000 }, { id: 1105, bought: 2.70, sold: 3.24, held: 8, burned: 4210000 },
               { id: 644, bought: 2.61, sold: 3.09, held: 10, burned: 3960000 }],
        auction: { token: 'FREE1376', lot: 4120, start: 1, ageH: 16.3 },
        burnCooldown: 0
      };
    },
    launch: function () {
      return {
        launch: true, launchMinute: 12, day: 0, floor: 2.74,
        taxCollected: 3.9, hookWaiting: 0.42, seatPot: 2.31, burnPot: 0.99, dev: 0.39, imdBurn: 0.195,
        burned: 0, imdBurned: 0, harvested: 0,
        seats: [], sold: [], auction: null, burnCooldown: 0
      };
    }
  };
  var S = PRESETS.steady();
  var wallet = null;
  var buying = true;

  // ------------------------------------------------------------------ rules, as in the contracts
  function buyTax() {
    if (!S.launch) return STANDING_TAX;
    var t = 0.99 - 0.01 * S.launchMinute;
    return t > STANDING_TAX ? t : STANDING_TAX;
  }
  function avgCost() {
    if (!S.seats.length) return 0;
    return S.seats.reduce(function (a, s) { return a + s.cost; }, 0) / S.seats.length;
  }
  function mode() {
    if (!S.seats.length || S.floor <= avgCost()) return { name: 'Spinning', cls: 'spinning', icon: '#ico-spin', seatBps: 0.7, why: S.seats.length ? 'floor is under what the vault paid, so 70% of the strategy share buys seats' : 'no seats held yet, so 70% of the strategy share buys seats' };
    return { name: 'Shedding', cls: 'shedding', icon: '#ico-shed', seatBps: 0.3, why: 'floor is above what the vault paid, so 70% of the strategy share burns PUPATE' };
  }
  function listPrice(s) { var d = Math.min(s.day, 14); return s.cost * (1.5 - 0.4 * d / 14); }
  function decay(start, ageH) {
    if (ageH >= 48) return 0;
    var steps = Math.floor(ageH / HALF_LIFE_H), into = ageH - steps * HALF_LIFE_H;
    var p = start / Math.pow(2, steps);
    return p - p * into / (2 * HALF_LIFE_H);
  }
  function nextSeatPrice() { return S.floor * (1 + REWARD); }

  // ------------------------------------------------------------------ formatting
  function eth(n, dp) { return n.toLocaleString('en-US', { minimumFractionDigits: dp === undefined ? 2 : dp, maximumFractionDigits: dp === undefined ? 2 : dp }) + ' ETH'; }
  function int(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return (n * 100).toFixed(n * 100 < 10 ? 1 : 0) + '%'; }
  function pad4(id) { return String(id).padStart(4, '0'); }

  // ------------------------------------------------------------------ rendering
  function setFig(id, value, small) {
    var el = byId(id), sm = el.querySelector('small');
    el.textContent = value;
    if (sm) { if (small !== undefined) sm.textContent = small; el.appendChild(sm); }
  }

  function render() {
    var m = mode();
    // conditions
    byId('cond-floor').textContent = eth(S.floor);
    var modeEl = byId('cond-mode');
    modeEl.className = 'value mode ' + m.cls;
    modeEl.querySelector('use').setAttribute('href', m.icon);
    modeEl.lastChild.textContent = m.name;
    byId('cond-mode-sub').textContent = m.why;
    var progress = Math.min(S.seatPot / nextSeatPrice(), 1);
    byId('cond-next').textContent = pct(progress);
    byId('cond-meter').querySelector('i').style.setProperty('--w', (progress * 100).toFixed(1) + '%');
    byId('cond-next-sub').textContent = eth(S.seatPot) + ' of ' + eth(S.floor) + ' in the seat pot' + (progress >= 1 ? '. A seat can be bought now.' : '');

    // feed
    setFig('fig-tax', eth(S.taxCollected, 1));
    setFig('fig-strategy', eth(S.taxCollected * 0.85, 1));
    setFig('fig-seatpot', eth(S.seatPot));
    setFig('fig-burnpot', eth(S.burnPot));
    setFig('fig-hook', eth(S.hookWaiting), S.hookWaiting > 0 ? 'flush it, no reward' : 'nothing waiting');
    setFig('fig-buytax', pct(buyTax()), 'sell tax 6%');
    byId('taxline').textContent = S.launch
      ? 'Buy tax now ' + pct(buyTax()) + '. Reaches 6% in ' + (93 - S.launchMinute) + ' minutes. Sell tax 6%.'
      : 'Buy tax now 6%. Sell tax 6%.';
    byId('swap-note').textContent = wallet
      ? 'Simulated wallet ' + wallet + '. Trades here change the figures on this page and nothing else.'
      : 'Simulated: the first click connects a pretend wallet, the next ones trade against the sample pool.';
    byId('cta').textContent = wallet ? (buying ? 'Buy PUPATE' : 'Sell PUPATE') : 'Connect wallet';
    byId('mast-note').innerHTML = S.launch ? 'PUPATE on Ethereum<br>pool opened ' + S.launchMinute + ' minutes ago' : 'PUPATE on Ethereum<br>pool opened 13 Sep 2026, day ' + S.day;
    updateReceive();

    // cocoon
    byId('cocoon-empty').hidden = S.seats.length > 0;
    byId('cocoon-live').hidden = S.seats.length === 0;
    var total = S.seats.reduce(function (a, s) { return a + s.cost; }, 0);
    byId('held-line').textContent = S.seats.length + (S.seats.length === 1 ? ' seat held, bought for ' : ' seats held, bought for ') + eth(total) + ' in all, ' + eth(avgCost()) + ' each on average';
    var drawer = byId('drawer');
    drawer.innerHTML = '';
    var tpl = byId('specimen-tpl');
    S.seats.forEach(function (s) {
      var node = tpl.content.cloneNode(true);
      var art = node.querySelector('.specimen');
      var d = Math.min(s.day, 14);
      art.style.setProperty('--ripe', (d / 14).toFixed(2));
      node.querySelector('.seat-id').textContent = 'Seat ' + pad4(s.id);
      var st = node.querySelector('.status');
      var atFloor = s.day >= 14;
      st.className = 'status ' + (atFloor ? 'ready' : s.status);
      st.textContent = atFloor ? 'at 1.1x, waiting' : s.status === 'working' ? 'working' : 'idle, no device';
      node.querySelector('.v-bought').textContent = eth(s.cost);
      node.querySelector('.v-listed').textContent = eth(listPrice(s));
      node.querySelector('.v-day').textContent = d + ' of 14';
      node.querySelector('.v-jobs').textContent = String(s.jobs);
      drawer.appendChild(node);
    });

    // emerge
    byId('emerge-empty').hidden = S.sold.length > 0 || S.auction !== null;
    byId('emerge-live').hidden = !(S.sold.length > 0 || S.auction !== null);
    var ledger = byId('ledger');
    ledger.innerHTML = '';
    S.sold.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.className = 'shellrow';
      tr.innerHTML = '<td><svg aria-hidden="true"><use href="#shell"/></svg> ' + pad4(r.id) + '</td><td class="num">' + eth(r.bought) + '</td><td class="num">' + eth(r.sold) + '</td><td class="num">' + r.held + ' days</td><td class="num">' + int(r.burned) + '</td>';
      ledger.appendChild(tr);
    });
    byId('burned-total').textContent = int(S.burned);
    byId('burned-label').textContent = 'Burned so far, ' + (S.burned / 1e9 * 100).toFixed(2) + '% of supply';
    setFig('fig-imd', int(S.imdBurned) + ' IMD');
    setFig('fig-harvest', eth(S.harvested));
    setFig('fig-dev', eth(S.dev));
    var auc = byId('auction');
    if (S.auction) {
      auc.hidden = false;
      var price = decay(S.auction.start, S.auction.ageH);
      byId('auction-value').innerHTML = int(S.auction.lot) + ' ' + S.auction.token + ' <span class="soft">for</span> ' + eth(price, 4);
      var left = Math.max(0, 48 - S.auction.ageH);
      byId('auction-sub').textContent = 'Earned by the seats while they worked. The price halves every 2 hours and is zero after 48; ' + Math.floor(left) + 'h ' + Math.round((left % 1) * 60) + 'm left. The first taker gets the whole lot, and the ETH goes to the seat pot.';
    } else {
      auc.hidden = true;
    }

    // steps
    step('step-flush', S.hookWaiting > 0, 'Moves ' + eth(S.hookWaiting) + ' from the hook to the vault. No reward.', 'Nothing is waiting in the hook. Trade first.');
    step('step-buy', S.seatPot >= nextSeatPrice(), 'Fills the cheapest listing at or under 105% of the reference price (' + eth(S.floor) + ' now). Reward 0.5% of the price.', 'Not available: the seat pot is at ' + pct(progress) + ' of a seat.');
    step('step-burn', S.burnPot > 0 && S.burnCooldown === 0, 'Spends up to the 5% price-impact limit of the burn pot (' + eth(S.burnPot) + ') on PUPATE and destroys it. Reward 0.5% of the ETH spent.', S.burnPot > 0 ? 'Available in ' + S.burnCooldown + ' blocks.' : 'The burn pot is empty.');
    step('step-auction', S.auction === null, 'Opens a falling-price auction for a token the seats earned. No reward; the buyer gets the discount.', 'An auction is already running. Take the lot or wait for it to fall.');
  }

  function step(id, enabled, when, why) {
    var row = byId(id);
    row.querySelector('button').disabled = !enabled;
    row.querySelector('.soft').textContent = enabled ? when : why;
  }

  // ------------------------------------------------------------------ actions
  var toastTimer;
  function toast(msg) {
    var t = byId('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }

  function flush() {
    var amount = S.hookWaiting;
    if (amount <= 0) return;
    var m = mode();
    S.dev += amount * 0.10;
    S.imdBurn += amount * 0.05;
    var strategy = amount * 0.85;
    S.seatPot += strategy * m.seatBps;
    S.burnPot += strategy * (1 - m.seatBps);
    S.hookWaiting = 0;
    toast('Flushed ' + eth(amount) + ' to the vault: ' + pct(m.seatBps) + ' of the strategy share to the seat pot (' + m.name + ').');
    render();
  }

  function buySeat() {
    var price = S.floor, reward = price * REWARD;
    if (S.seatPot < price + reward) return;
    S.seatPot -= price + reward;
    var id = 100 + Math.floor(Math.random() * 1900);
    S.seats.push(seat(id, price, 0, 0, 'working'));
    toast('Bought seat ' + pad4(id) + ' for ' + eth(price) + ' and listed it at ' + eth(price * 1.5) + '. Caller reward ' + eth(reward, 4) + '.');
    render();
  }

  function burn() {
    if (S.burnPot <= 0 || S.burnCooldown > 0) return;
    var spend = Math.min(S.burnPot * (1 - REWARD), IMPACT_CAP_ETH), reward = spend * REWARD;
    S.burnPot -= spend + reward;
    var got = spend * RATE * (1 - LP);
    S.burned += got;
    S.burnCooldown = 5;
    toast('Burned ' + int(got) + ' PUPATE with ' + eth(spend, 3) + (spend < S.burnPot + spend ? ' (stopped at the 5% impact limit)' : '') + '. Caller reward ' + eth(reward, 4) + '.');
    render();
    var tick = setInterval(function () { S.burnCooldown -= 1; if (S.burnCooldown <= 0) { S.burnCooldown = 0; clearInterval(tick); } render(); }, 1200);
  }

  function startAuction() {
    if (S.auction) return;
    S.auction = { token: 'SOME', lot: 1000, start: 1, ageH: 0 };
    toast('Auction opened: 1,000 SOME, starting at 1 ETH and halving every 2 hours.');
    render();
  }

  function takeAuction() {
    if (!S.auction) return;
    var price = decay(S.auction.start, S.auction.ageH);
    S.seatPot += price;
    S.harvested += price;
    toast('Took ' + int(S.auction.lot) + ' ' + S.auction.token + ' for ' + eth(price, 4) + '. The ETH went to the seat pot.');
    S.auction = null;
    render();
  }

  function advanceDay() {
    if (S.launch) { S.launchMinute = Math.min(S.launchMinute + 30, 93); toast('Half an hour later: the buy tax is ' + pct(buyTax()) + '.'); render(); return; }
    S.day += 1;
    S.seats.forEach(function (s) { s.day += 1; if (s.status === 'working') s.jobs += 3 + Math.floor(Math.random() * 7); });
    if (S.auction) S.auction.ageH += 24;
    S.floor = Math.round(S.floor * (0.97 + Math.random() * 0.06) * 100) / 100;
    S.burnCooldown = 0;
    // One seat at the tail may sell on any given day.
    var ripe = S.seats.filter(function (s) { return s.day >= 10; });
    if (ripe.length && Math.random() < 0.5) {
      var s = ripe[0];
      var price = listPrice(s);
      S.seats.splice(S.seats.indexOf(s), 1);
      S.burnPot += price;
      S.sold.unshift({ id: s.id, bought: s.cost, sold: price, held: s.day, burned: 0 });
      toast('A day passed. Seat ' + pad4(s.id) + ' sold for ' + eth(price) + '; the ETH is in the burn pot.');
    } else {
      toast('A day passed. Listings fell, the seats kept working, the floor is ' + eth(S.floor) + '.');
    }
    render();
  }

  function swap(e) {
    e.preventDefault();
    if (!wallet) { wallet = '0x3f…9c2a'; toast('Pretend wallet connected. Nothing can be sent from this page.'); render(); return; }
    var v = parseFloat(String(byId('amount').value).replace(',', '.'));
    if (!(v > 0)) return;
    if (buying) {
      var tax = v * buyTax();
      S.taxCollected += tax; S.hookWaiting += tax;
      toast('Bought ' + int(v * (1 - buyTax()) * (1 - LP) * RATE) + ' PUPATE for ' + eth(v) + '. Tax ' + eth(tax, 3) + ' waits in the hook.');
    } else {
      var out = v / RATE * (1 - LP), stax = out * STANDING_TAX;
      S.taxCollected += stax; S.hookWaiting += stax;
      toast('Sold ' + int(v) + ' PUPATE for ' + eth(out * (1 - STANDING_TAX), 4) + '. Tax ' + eth(stax, 4) + ' waits in the hook.');
    }
    render();
  }

  function updateReceive() {
    var v = parseFloat(String(byId('amount').value).replace(',', '.'));
    var out = byId('receive');
    if (!(v > 0)) { out.textContent = buying ? '0 PUPATE' : '0 ETH'; return; }
    if (buying) out.textContent = int(v * (1 - buyTax()) * (1 - LP) * RATE) + ' PUPATE';
    else out.textContent = (v / RATE * (1 - LP) * (1 - STANDING_TAX)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ETH';
  }

  function setDirection(buy) {
    buying = buy;
    byId('buy-btn').setAttribute('aria-pressed', buy ? 'true' : 'false');
    byId('sell-btn').setAttribute('aria-pressed', buy ? 'false' : 'true');
    byId('amount-label').textContent = buy ? 'You pay' : 'You sell';
    byId('amount-unit').textContent = buy ? 'ETH' : 'PUPATE';
    byId('amount').value = buy ? '0.5' : '10000000';
    render();
  }

  function applyPreset(name) {
    S = PRESETS[name]();
    byId('state-steady').setAttribute('aria-pressed', name === 'steady' ? 'true' : 'false');
    byId('state-launch').setAttribute('aria-pressed', name === 'launch' ? 'true' : 'false');
    byId('advance').textContent = name === 'launch' ? 'Advance 30 minutes' : 'Advance a day';
    render();
  }

  // ------------------------------------------------------------------ wiring
  byId('buy-btn').addEventListener('click', function () { setDirection(true); });
  byId('sell-btn').addEventListener('click', function () { setDirection(false); });
  byId('amount').addEventListener('input', updateReceive);
  byId('swap').addEventListener('submit', swap);
  byId('state-steady').addEventListener('click', function () { applyPreset('steady'); });
  byId('state-launch').addEventListener('click', function () { applyPreset('launch'); });
  byId('advance').addEventListener('click', advanceDay);
  byId('step-flush').querySelector('button').addEventListener('click', flush);
  byId('step-buy').querySelector('button').addEventListener('click', buySeat);
  byId('step-burn').querySelector('button').addEventListener('click', burn);
  byId('step-auction').querySelector('button').addEventListener('click', startAuction);
  byId('auction-take').addEventListener('click', takeAuction);

  // The report's age ticks from the sample value, so the freshness line reads like the live one.
  var fresh = byId('cond-fresh'), reportedAgo = 108 * 60, loadedAt = Date.now();
  function hm(sec) { var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return (h ? h + 'h ' : '') + m + 'm'; }
  function tick() {
    var ago = reportedAgo + Math.floor((Date.now() - loadedAt) / 1000), left = 6 * 3600 - ago;
    fresh.textContent = left > 0 ? 'reported ' + hm(ago) + ' ago, fresh for ' + hm(left) + ' more' : 'reported ' + hm(ago) + ' ago, stale: the vault is not buying';
  }
  tick();
  setInterval(tick, 30000);

  applyPreset('steady');
})();
