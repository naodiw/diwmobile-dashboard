(() => {
  'use strict';

  /* ================================================================ config */

  const API_URL = window.ENVIDAS_API || '';
  // Cloudflare Worker ที่แคชคำตอบของ Apps Script ไว้ (ตอบใน ~0.2 วินาที) ใช้เป็นทางหลัก
  // ถ้า Worker มีปัญหา ถอยกลับไปเรียก Apps Script ตรง ๆ
  const CACHE_API = (window.ENVIDAS_CACHE_API || '').replace(/\/+$/, '');
  const params = new URLSearchParams(location.search);
  const MOCK = params.has('mock'); // ?mock=1 ใช้ไฟล์ dev/sample-*.json แทน API (ไว้พัฒนาบนเครื่อง)
  const REFRESH_MS = 60_000;

  const CH = {
    'PM2.5': { th: 'ฝุ่น PM2.5', dp: 1 },
    PM10: { th: 'ฝุ่น PM10', dp: 1 },
    SO2: { th: 'ซัลเฟอร์ไดออกไซด์', short: 'SO₂', dp: 1 },
    NO2: { th: 'ไนโตรเจนไดออกไซด์', short: 'NO₂', dp: 1 },
    CO: { th: 'คาร์บอนมอนอกไซด์', short: 'CO', dp: 2 },
    O3: { th: 'โอโซน', short: 'O₃', dp: 1 },
    VOC: { th: 'สารอินทรีย์ระเหยง่าย', short: 'VOC', dp: 3 },
    WS: { th: 'ความเร็วลม', dp: 1 },
    WD: { th: 'ทิศทางลม', dp: 0 },
    TEMP: { th: 'อุณหภูมิ', dp: 1 },
    RH: { th: 'ความชื้นสัมพัทธ์', dp: 0 },
    // เครื่องวัดส่งมาเป็น hPa แสดงผลเป็น mmHg (1 hPa = 0.750062 mmHg)
    BP: { th: 'ความกดอากาศ', dp: 1, unit: 'mmHg', factor: 0.750062 },
  };
  const TILE_ORDER = ['PM2.5', 'PM10', 'O3', 'NO2', 'SO2', 'CO', 'VOC', 'TEMP', 'RH', 'WS', 'WD', 'BP'];
  const GAS = ['SO2', 'NO2', 'O3', 'CO', 'VOC'];
  const ZERO_BASED = new Set(['PM2.5', 'PM10', 'SO2', 'NO2', 'CO', 'O3', 'VOC', 'WS']);

  // ค่ามาตรฐานในบรรยากาศทั่วไป เฉลี่ย 24 ชม. (ประกาศคณะกรรมการสิ่งแวดล้อมแห่งชาติ)
  const STANDARD_24H = { 'PM2.5': 37.5, PM10: 120 };

  /* ------------------------------------------------------------------ AQI */
  // ยึดตาม https://pm2_5.nrct.go.th/definition ตาราง "เกณฑ์ของดัชนีคุณภาพอากาศตาม
  // มาตรฐานของประเทศไทย (TH AQI)" ทั้งช่วงค่า ชื่อระดับ คำแนะนำ และสี (สีดึงจากไอคอน
  // สัญลักษณ์ในเว็บ) ระดับบนสุดเว็บเขียน "200 ขึ้นไป" ไม่มีสูตรต่อ จึงแสดงเป็น ">200"
  const AQI_BANDS = [
    { max: 25, label: 'คุณภาพอากาศดีมาก', color: '#05a7de',
      general: 'คุณภาพอากาศดีมาก เหมาะสำหรับกิจกรรมกลางแจ้งและการท่องเที่ยว' },
    { max: 50, label: 'คุณภาพอากาศดี', color: '#00af4f',
      general: 'คุณภาพอากาศดี สามารถทำกิจกรรมกลางแจ้งและท่องเที่ยวได้ตามปกติ' },
    { max: 100, label: 'คุณภาพอากาศปานกลาง', color: '#ffe600',
      general: 'สามารถทำกิจกรรมกลางแจ้งได้ตามปกติ',
      risk: 'หากมีอาการเบื้องต้น เช่น ไอ หายใจลำบาก ระคายเคืองตา ควรลดระยะเวลาการทำกิจกรรมกลางแจ้ง' },
    { max: 200, label: 'คุณภาพอากาศมีผลกระทบต่อสุขภาพ', color: '#f79838',
      general: 'ควรเฝ้าระวังสุขภาพ ถ้ามีอาการเบื้องต้น เช่น ไอ หายใจลำบาก ระคายเคืองตา ควรลดระยะเวลาการทำกิจกรรมกลางแจ้ง หรือใช้อุปกรณ์ป้องกันตนเองหากมีความจำเป็น',
      risk: 'ควรลดระยะเวลาการทำกิจกรรมกลางแจ้ง หรือใช้อุปกรณ์ป้องกันตนเองหากมีความจำเป็น ถ้ามีอาการทางสุขภาพ เช่น ไอ หายใจลำบาก ตาอักเสบ แน่นหน้าอก ปวดศีรษะ หัวใจเต้นไม่เป็นปกติ คลื่นไส้ อ่อนเพลีย ควรพบแพทย์' },
    { max: Infinity, label: 'คุณภาพอากาศมีผลกระทบต่อสุขภาพมาก', color: '#ec2224',
      general: 'ประชาชนทุกคนควรหลีกเลี่ยงกิจกรรมกลางแจ้ง หลีกเลี่ยงพื้นที่ที่มีมลพิษทางอากาศสูง หรือใช้อุปกรณ์ป้องกันตนเองหากมีความจำเป็น หากมีอาการทางสุขภาพควรพบแพทย์' },
  ];
  const AQI_INDEX = [[0, 25], [26, 50], [51, 100], [101, 200]];
  const AQI_RULES = {
    'PM2.5': { hours: 24, minHours: 12, bp: [[0, 15.0], [15.1, 25.0], [25.1, 37.5], [37.6, 75.0]], label: 'PM2.5 เฉลี่ย 24 ชม.' },
    PM10: { hours: 24, minHours: 12, bp: [[0, 50], [51, 80], [81, 120], [121, 180]], label: 'PM10 เฉลี่ย 24 ชม.' },
    O3: { hours: 8, minHours: 6, bp: [[0, 35], [36, 50], [51, 70], [71, 120]], label: 'O₃ เฉลี่ย 8 ชม.' },
    CO: { hours: 8, minHours: 6, bp: [[0, 4.4], [4.5, 6.4], [6.5, 9], [9.1, 30]], label: 'CO เฉลี่ย 8 ชม.' },
    NO2: { hours: 1, minHours: 1, bp: [[0, 60], [61, 106], [107, 170], [171, 340]], label: 'NO₂ เฉลี่ย 1 ชม.' },
    SO2: { hours: 1, minHours: 1, bp: [[0, 100], [101, 200], [201, 300], [301, 400]], label: 'SO₂ เฉลี่ย 1 ชม.' },
  };

  /* ============================================================== helpers */

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isDark = () => css('color-scheme') === 'dark';

  function unitText(u) {
    return String(u || '')
      .replace(/^ug\/m3$/i, 'µg/m³')
      .replace(/^DegC$/i, '°C')
      .replace(/^Deg$/i, '°');
  }

  /** แปลงค่าตามหน่วยที่ใช้แสดง (เช่น hPa -> mmHg) */
  function conv(name, v) {
    const m = CH[name];
    if (v === null || v === undefined || !m || !m.factor) return v;
    return v * m.factor;
  }
  const unitFor = (name, rawUnit) => (CH[name] && CH[name].unit) || unitText(rawUnit);

  function fmt(v, dp) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
    return Number(v).toLocaleString('th-TH', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  const COMPASS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
  const compass = (deg) => (Number.isFinite(deg) ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8] : '');

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} วินาที`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} นาที`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} ชั่วโมง`;
    return `${Math.round(h / 24)} วัน`;
  }

  const thaiDateTime = (t) =>
    new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const ICON_WARN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fab219" d="M12 2 1 21h22z"/><path d="M12 9v5M12 17.5v.01" stroke="#0b0b0b" stroke-width="2.2" stroke-linecap="round"/></svg>';

  /* ================================================================ state */

  const state = { days: 7, data: null, charts: {}, map: null, marker: null, ring: null, timer: null, loading: false, failures: 0, retryTimer: null };

  /* ------------------------------------------------------------ snapshot */
  // เก็บข้อมูลชุดล่าสุดที่โหลดสำเร็จไว้ในเบราว์เซอร์ของผู้ชม เปิดหน้าครั้งต่อไป
  // จะเห็นข้อมูลทันทีระหว่างรอ API และยังดูได้ถ้า API ล่ม (เวลาอัปเดตบอกความเก่าตามจริง)
  const snapKey = (days) => `envidas.snapshot.${days}`;
  function saveSnapshot(days, data) {
    try { localStorage.setItem(snapKey(days), JSON.stringify(data)); } catch (e) { /* storage เต็มหรือถูกปิด ไม่เป็นไร */ }
  }
  function loadSnapshot(days) {
    try {
      const raw = localStorage.getItem(snapKey(days));
      const d = raw ? JSON.parse(raw) : null;
      return d && d.status === 'ok' && d.live ? d : null;
    } catch (e) { return null; }
  }

  function setNotice(text) {
    const box = $('noticeBox');
    box.textContent = text || '';
    box.hidden = !text;
  }

  /* ================================================================ fetch */

  /**
   * วิธีหลัก: fetch แบบไม่แนบ cookie (credentials: 'omit')
   * Apps Script ส่ง Access-Control-Allow-Origin: * จึงเรียกข้ามโดเมนได้ตรง ๆ
   * ต่างจาก <script> (JSONP) ที่เบราว์เซอร์แนบ cookie ของ Google ไปด้วย ถ้าผู้ชม
   * ล็อกอิน Google ไว้ (โดยเฉพาะหลายบัญชีบนมือถือ) Apps Script อาจตอบเป็นหน้า HTML
   * แทนข้อมูล ทำให้หน้าเว็บขึ้นแต่ไม่มีข้อมูล (เจอจริงบนมือถือ 17/09/2026)
   */
  async function fetchApi(query, outerSignal, timeoutMs = 25_000) {
    const url = new URL(API_URL);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('_', `${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
    return fetchJsonUrl(url.toString(), outerSignal, timeoutMs);
  }

  /** ทางหลัก: อ่านจาก Cloudflare Worker ลอง 2 ครั้ง ครั้งละไม่เกิน 10 วินาที */
  async function fetchWorker(days) {
    let last;
    for (let i = 0; i < 2; i++) {
      try {
        const d = await fetchJsonUrl(`${CACHE_API}/api?days=${days}`, undefined, 10_000);
        if (d && d.status === 'ok') return d;
        throw new Error((d && d.message) || 'Worker ตอบกลับผิดรูปแบบ');
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function fetchJsonUrl(href, outerSignal, timeoutMs) {
    const url = { toString: () => href };
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (outerSignal && ctrl) outerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error('ได้หน้าเว็บแทนข้อมูล');
      }
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? 'หมดเวลารอ' : (err && err.message) || String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ยิงคำขอแบบสำรองซ้อน (hedged request)
   *
   * วัดจริง 17/09/2026: Web App ของ Apps Script ตอบครึ่งหนึ่งภายใน 7 วินาที แต่บางครั้ง
   * นาน 30+ วินาที หรือตอบ 404 เป็นหน้า HTML ราว 15% ทั้งที่โค้ดในสคริปต์ใช้แค่ ~1 วินาที
   * ความช้าอยู่ที่ชั้นของ Google เอง และคำขอใหม่มักผ่านทันที
   * จึงยิงคำขอแรก ถ้า 5 วินาทียังไม่ตอบให้ยิงสำรองเพิ่ม (สูงสุด 3 คำขอ) ถ้าพลาดยิงใหม่ทันที
   * ใช้ผลของคำขอที่ตอบถูกก่อน แล้วยกเลิกที่เหลือ ฝั่งเซิร์ฟเวอร์มีแคชจึงแทบไม่เพิ่มภาระ
   */
  function fetchHedged(query) {
    const MAX = 3;
    const HEDGE_MS = [0, 5_000, 12_000];
    const master = typeof AbortController === 'function' ? new AbortController() : null;
    return new Promise((resolve, reject) => {
      let started = 0;
      let failed = 0;
      let settled = false;
      const errors = [];
      const timers = [];
      const launch = () => {
        if (settled || started >= MAX) return;
        started += 1;
        fetchApi(query, master && master.signal)
          .then((data) => {
            if (settled) return;
            if (!data || data.status !== 'ok') throw new Error((data && data.message) || 'API ตอบกลับผิดรูปแบบ');
            settled = true;
            timers.forEach(clearTimeout);
            if (master) master.abort();
            resolve(data);
          })
          .catch((err) => {
            if (settled) return;
            failed += 1;
            errors.push(err.message);
            if (failed >= MAX) {
              settled = true;
              timers.forEach(clearTimeout);
              reject(new Error(errors.join(' / ')));
            } else {
              launch(); // พลาดแล้วยิงใหม่ทันที ไม่ต้องรอรอบสำรอง
            }
          });
      };
      HEDGE_MS.forEach((ms) => timers.push(setTimeout(launch, ms)));
    });
  }

  function fetchJsonp(query) {
    return new Promise((resolve, reject) => {
      const cb = `envidas_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(API_URL);
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
      url.searchParams.set('callback', cb);
      url.searchParams.set('_', String(Date.now()));

      const script = document.createElement('script');
      const timer = setTimeout(() => done(new Error('เซิร์ฟเวอร์ตอบช้าเกินไป')), 20_000);
      function done(err, payload) {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
        err ? reject(err) : resolve(payload);
      }
      window[cb] = (payload) => done(null, payload);
      script.onerror = () => done(new Error('เชื่อมต่อ API ไม่ได้'));
      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $('refreshBtn').classList.add('is-spinning');
    try {
      let data;
      if (MOCK) {
        const r = await fetch(`./dev/sample-${state.days}.json`, { cache: 'no-store' });
        data = await r.json();
      } else {
        if (!API_URL) throw new Error('ยังไม่ได้ตั้งค่า URL ของ API ใน index.html (window.ENVIDAS_API)');
        const query = { dashboard: '1', days: state.days, resolution: 'auto' };
        let e0 = null;
        if (CACHE_API) {
          try {
            data = await fetchWorker(state.days);
          } catch (err) {
            e0 = err;
          }
        }
        if (!data) {
          try {
            data = await fetchHedged(query);
          } catch (e1) {
            // สำรองสุดท้าย: JSONP (เผื่อเบราว์เซอร์/เครือข่ายบางแห่งบล็อก fetch ข้ามโดเมน)
            try {
              data = await fetchJsonp(query);
            } catch (e2) {
              throw new Error(`${e0 ? `cache: ${e0.message} / ` : ''}fetch: ${e1.message} / script: ${e2.message}`);
            }
          }
        }
      }
      if (!data || data.status !== 'ok') throw new Error((data && data.message) || 'API ตอบกลับผิดรูปแบบ');
      if (data.days && Number(data.days) !== state.days) return; // ผู้ใช้เปลี่ยนช่วงเวลาไปแล้ว
      state.data = data;
      state.lastLoadAt = Date.now();
      state.failures = 0;
      clearTimeout(state.retryTimer);
      $('errorBox').hidden = true;
      setNotice(data.stale ? 'Google Sheets ขัดข้องชั่วคราว กำลังแสดงข้อมูลสำรองชุดล่าสุด' : '');
      if (!data.stale) saveSnapshot(state.days, data);
      render();
    } catch (err) {
      state.failures += 1;
      const snap = !state.data ? loadSnapshot(state.days) : null;
      if (snap) {
        state.data = snap;
        render();
      }
      if (state.data) {
        $('errorBox').hidden = true;
        setNotice(`ยังเชื่อมต่อข้อมูลล่าสุดไม่ได้ กำลังแสดงข้อมูลที่โหลดไว้ครั้งก่อน และจะลองใหม่อัตโนมัติ (${err.message})`);
      } else {
        const box = $('errorBox');
        box.textContent = `โหลดข้อมูลไม่สำเร็จ: ${err.message} · จะลองใหม่อัตโนมัติ`;
        box.hidden = false;
        setFreshness('down', 'โหลดไม่สำเร็จ');
      }
      // ลองใหม่เร็วขึ้นหลังพลาด 15 วิ -> 30 -> 60 วิ ไม่ต้องรอรอบปกติ
      clearTimeout(state.retryTimer);
      const wait = Math.min(15_000 * 2 ** (state.failures - 1), REFRESH_MS);
      state.retryTimer = setTimeout(() => document.visibilityState === 'visible' && load(), wait);
    } finally {
      state.loading = false;
      $('refreshBtn').classList.remove('is-spinning');
    }
  }

  /* =============================================================== render */

  function render() {
    const d = state.data;
    renderHeader(d);
    renderFreshness();
    renderAqi(d);
    renderMap(d);
    renderTiles(d);
    renderCharts(d);
    renderTable(d);
  }

  /**
   * ชื่อจุดจอดจากช่อง location_label ในชีต Settings
   * ข้อความ "พิกัดที่ยืนยันด้วยมือ ..." เป็นค่าตั้งต้นที่ระบบเติมให้ตอนสร้างชีต ไม่ใช่ชื่อสถานที่
   * จึงไม่แสดง (dashboard ไม่บอกที่มาของพิกัด)
   */
  function placeLabel(loc) {
    const s = String((loc && loc.label) || '').trim();
    return /ยืนยันด้วยมือ|กรอกเอง|^manual$/i.test(s) ? '' : s;
  }

  const addressText = (loc) => (loc && loc.address && loc.address.text) || '';

  function renderHeader(d) {
    // ชื่อจุดที่กรอกเองมาก่อน แล้วต่อด้วยที่อยู่ระดับตำบลที่ได้จากพิกัด
    const place = [placeLabel(d.location), addressText(d.location)].filter(Boolean).join(' · ');
    $('placeLine').textContent = place ? `จอดอยู่ที่ ${place}` : '';
    $('updatedAt').textContent = d.live.updatedAt ? `อัปเดต ${thaiDateTime(d.live.updatedAtMs)} น.` : '';
  }

  function setFreshness(kind, text) {
    const el = $('freshness');
    el.className = `freshness is-${kind}`;
    $('freshnessText').textContent = text;
  }

  function renderFreshness() {
    const d = state.data;
    if (!d || !d.live.updatedAtMs) return setFreshness('loading', 'ไม่ทราบเวลา');
    const age = Date.now() - d.live.updatedAtMs;
    if (age < 3 * 60_000) setFreshness('live', `สด · ${ago(age)}ที่แล้ว`);
    else if (age < 15 * 60_000) setFreshness('late', `ล่าช้า ${ago(age)}`);
    else setFreshness('down', `ขาดการติดต่อ ${ago(age)}`);
  }

  /* ------------------------------------------------------------------ AQI */

  function mean(arr) {
    const xs = arr.filter((x) => x !== null && Number.isFinite(x));
    return xs.length ? { avg: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : { avg: null, n: 0 };
  }

  /** สมการเส้นตรงตามเว็บ: I = (Ij − Ii)/(Xj − Xi) × (X − Xi) + Ii  เกินช่วงบนสุด = >200 */
  function subIndex(x, bp) {
    for (let i = 0; i < bp.length; i++) {
      const [lo, hi] = bp[i];
      // ช่องว่างระหว่างช่วง (เช่น 15.0 กับ 15.1) ปัดเข้าช่วงที่ต่ำกว่า
      if (x <= hi || (i + 1 < bp.length && x < bp[i + 1][0])) {
        const [ilo, ihi] = AQI_INDEX[i];
        return Math.round(((ihi - ilo) / (hi - lo)) * (Math.min(Math.max(x, lo), hi) - lo) + ilo);
      }
    }
    return Infinity;
  }

  function computeAqi(recent) {
    const parts = [];
    Object.entries(AQI_RULES).forEach(([name, rule]) => {
      const col = recent[name];
      if (!col) return;
      const { avg, n } = mean(col.slice(-rule.hours));
      if (avg === null || n < rule.minHours) return;
      parts.push({ name, rule, avg, n, index: subIndex(avg, rule.bp) });
    });
    if (!parts.length) return null;
    parts.sort((a, b) => b.index - a.index);
    return { top: parts[0], parts };
  }

  function renderAqi(d) {
    const aqi = computeAqi(d.recent || {});
    const items = document.querySelectorAll('.aqi-scale li');
    items.forEach((li) => li.classList.remove('is-current'));

    if (!aqi) {
      $('aqiValue').textContent = '–';
      $('aqiLabel').textContent = 'ข้อมูลไม่พอ';
      $('aqiSwatch').style.background = '';
      $('aqiAdvice').textContent = 'ต้องมีข้อมูลรายชั่วโมงอย่างน้อย 12 ชั่วโมงในรอบ 24 ชั่วโมงล่าสุด';
      $('aqiNote').textContent = '';
      return;
    }
    const { top } = aqi;
    const bandIdx = AQI_BANDS.findIndex((b) => top.index <= b.max);
    const band = AQI_BANDS[bandIdx];
    $('aqiValue').textContent = top.index > 200 ? '>200' : String(top.index);
    $('aqiLabel').textContent = band.label;
    $('aqiSwatch').style.background = band.color;
    $('aqiAdvice').innerHTML = band.risk
      ? `<b>ประชาชนทั่วไป</b> ${escapeHtml(band.general)}<br><b>กลุ่มเสี่ยง</b> ${escapeHtml(band.risk)}`
      : escapeHtml(band.general);
    items[bandIdx] && items[bandIdx].classList.add('is-current');

    const unit = top.name.startsWith('PM') ? 'µg/m³' : top.name === 'CO' ? 'ppm' : 'ppb';
    $('aqiNote').textContent =
      `ค่าหลักคือ ${top.rule.label} = ${fmt(top.avg, top.name === 'CO' ? 2 : 1)} ${unit}` +
      (top.rule.hours > 1 ? ` (มีข้อมูล ${top.n}/${top.rule.hours} ชม.)` : '');
  }

  /* ------------------------------------------------------------------ map */

  function renderMap(d) {
    const loc = d.location;
    if (!loc || !window.L) {
      $('locLabel').textContent = 'ไม่ทราบตำแหน่ง';
      $('locCoords').textContent = '';
      $('gmapsLink').hidden = true;
      return;
    }
    const custom = placeLabel(loc);
    const address = addressText(loc);
    const label = custom || address;
    $('locLabel').textContent = label || 'ตำแหน่งรถ';
    $('locCoords').textContent = [custom && address ? address : '', `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`]
      .filter(Boolean).join(' · ');
    const gm = $('gmapsLink');
    gm.hidden = false;
    gm.href = `https://www.google.com/maps?q=${loc.lat},${loc.lon}`;

    // OpenStreetMap ใช้ได้ฟรีไม่ต้องมี API key (CARTO เดิมขึ้นลายน้ำ "API KEY REQUIRED")
    // โหมดมืดใช้ CSS กลับสีพื้นแผนที่แทน เพราะ OSM ไม่มีแบบมืด
    const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    $('map').classList.toggle('is-dark', isDark());

    if (!state.map) {
      // บนมือถือปิดการลากด้วยนิ้วเดียว ไม่งั้นนิ้วที่ปัดเลื่อนหน้าจะไปลากแผนที่แทน
      // ยังซูมได้ด้วยสองนิ้วหรือปุ่ม +/−
      state.map = L.map('map', {
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
        touchZoom: true,
        attributionControl: true,
      }).setView([loc.lat, loc.lon], 14);
      state.tiles = L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(state.map);
    } else {
      state.tiles.setUrl(tileUrl);
    }

    const accent = css('--accent');
    const surface = css('--surface');
    if (state.ring) state.ring.remove();
    if (state.marker) state.marker.remove();
    if (loc.accuracy && loc.accuracy > 15) {
      state.ring = L.circle([loc.lat, loc.lon], { radius: loc.accuracy, color: accent, weight: 1, fillOpacity: 0.08 }).addTo(state.map);
    }
    state.marker = L.circleMarker([loc.lat, loc.lon], {
      radius: 9,
      color: surface,
      weight: 3,
      fillColor: accent,
      fillOpacity: 1,
    })
      .addTo(state.map)
      .bindTooltip(label || 'ตำแหน่งรถ', { direction: 'top', offset: [0, -8] });

    if (!state.mapCentered || state.lastLoc !== `${loc.lat},${loc.lon}`) {
      state.map.setView([loc.lat, loc.lon], state.map.getZoom());
      state.mapCentered = true;
      state.lastLoc = `${loc.lat},${loc.lon}`;
    }
    setTimeout(() => state.map.invalidateSize(), 50);
  }

  /* ---------------------------------------------------------------- tiles */

  function renderTiles(d) {
    const byName = Object.fromEntries(d.live.channels.map((c) => [c.name, c]));
    const html = TILE_ORDER.filter((n) => byName[n]).map((name) => {
      const c = byName[name];
      const meta = CH[name] || { th: name, dp: 1 };
      const hour = conv(name, c.values['1 ชม.']);
      const minute = conv(name, c.values['1 นาที']);
      const unit = unitFor(name, c.unit);
      const main = name === 'WD' && Number.isFinite(hour) ? `${fmt(hour, 0)}°` : fmt(hour, meta.dp);
      const empty = !Number.isFinite(hour);
      const problem = c.problem
        ? `<p class="tile-flag">${ICON_WARN}<span>${escapeHtml(c.problem)}</span></p>`
        : '';
      return `
        <article class="tile${c.problem ? ' has-problem' : ''}${empty ? ' is-empty' : ''}">
          <p class="tile-name">${meta.th}${meta.short ? ` <small>${meta.short}</small>` : ''}</p>
          <span class="tile-value">${main}${name === 'WD' ? '' : `<span class="unit">${unit}</span>`}</span>
          ${name === 'WD' && Number.isFinite(hour) ? `<p class="tile-sub tile-dir">ลมพัดมาจากทิศ${compass(hour)}</p>` : ''}
          <p class="tile-sub">1 นาที: ${name === 'WD' ? `${fmt(minute, 0)}°` : fmt(minute, meta.dp)}</p>
          ${problem}
        </article>`;
    });
    $('tiles').innerHTML = html.join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* --------------------------------------------------------------- charts */

  function theme() {
    return {
      text: css('--text'),
      text2: css('--text-2'),
      text3: css('--text-3'),
      grid: css('--grid'),
      line: css('--line'),
      surface: css('--surface'),
      s1: css('--series-1'),
      s2: css('--series-2'),
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  function chart(id) {
    const el = $(id);
    if (!el || !window.echarts) return null;
    let c = state.charts[id];
    if (c && c.getDom() !== el) {
      c.dispose();
      c = null;
    }
    if (!c) {
      c = echarts.init(el, null, { renderer: 'svg' });
      state.charts[id] = c;
    }
    return c;
  }

  function timeAxis(t, days) {
    return {
      type: 'time',
      axisLine: { lineStyle: { color: t.line } },
      axisTick: { show: false },
      axisLabel: {
        color: t.text3,
        hideOverlap: true,
        formatter: (v) => {
          const dt = new Date(v);
          return days <= 1
            ? dt.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
            : dt.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });
        },
      },
      splitLine: { show: false },
    };
  }

  function valueAxis(t, zero) {
    const axis = {
      type: 'value',
      splitNumber: 3,
      axisLabel: { color: t.text3, hideOverlap: true },
      splitLine: { lineStyle: { color: t.grid } },
    };
    if (zero) {
      axis.min = 0;
    } else {
      // อุณหภูมิ ความชื้น ความกดอากาศ ไม่ควรเริ่มจากศูนย์ ไม่งั้นเส้นแบนดูไม่ออก
      // เผื่อขอบบนล่าง 10% ของช่วงค่าจริง
      axis.min = (v) => {
        const pad = Math.max((v.max - v.min) * 0.1, 0.5);
        return Math.floor(v.min - pad);
      };
      axis.max = (v) => {
        const pad = Math.max((v.max - v.min) * 0.1, 0.5);
        return Math.ceil(v.max + pad);
      };
    }
    return axis;
  }

  function tooltip(t, dp, unit) {
    return {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.text3, width: 1 } },
      backgroundColor: t.surface,
      borderColor: t.line,
      textStyle: { color: t.text, fontFamily: t.font },
      valueFormatter: (v) => (v === null || v === undefined ? 'ไม่มีข้อมูล' : `${fmt(v, dp)} ${unit}`),
    };
  }

  const pairs = (ts, vs) => ts.map((x, i) => [x, vs ? vs[i] : null]);

  function renderCharts(d) {
    const t = theme();
    const s = d.series;
    const unitOf = Object.fromEntries(d.channels.map((c) => [c.name, unitText(c.unit)]));

    const resLabel = { '1h': '1 ชั่วโมง', '3h': '3 ชั่วโมง', '6h': '6 ชั่วโมง', '1d': '1 วัน' }[d.resolution] || d.resolution;
    $('resolutionNote').textContent = `ค่าเฉลี่ยทุก ${resLabel} · ${s.t.length} จุด${s.t.length ? ` · ${thaiDateTime(s.t[0])} – ${thaiDateTime(s.t[s.t.length - 1])}` : ''}`;

    // ---- PM ----------------------------------------------------------------
    const pm = chart('pmChart');
    if (pm) {
      const stdLine = (name) => ({
        silent: true,
        symbol: 'none',
        lineStyle: { color: t.text3, type: [4, 3], width: 1 },
        label: { color: t.text3, fontSize: 11, position: 'insideEndTop', formatter: `${name} ${STANDARD_24H[name]}` },
        data: [{ yAxis: STANDARD_24H[name] }],
      });
      pm.setOption(
        {
          animation: false,
          textStyle: { fontFamily: t.font },
          grid: { left: 44, right: 16, top: 16, bottom: 28 },
          tooltip: tooltip(t, 1, 'µg/m³'),
          xAxis: timeAxis(t, d.days),
          yAxis: valueAxis(t, true),
          series: [
            {
              name: 'PM2.5', type: 'line', showSymbol: false, connectNulls: false,
              lineStyle: { width: 2, color: t.s1 }, itemStyle: { color: t.s1 },
              emphasis: { focus: 'series' },
              data: pairs(s.t, s['PM2.5']), markLine: stdLine('PM2.5'),
            },
            {
              name: 'PM10', type: 'line', showSymbol: false, connectNulls: false,
              lineStyle: { width: 2, color: t.s2 }, itemStyle: { color: t.s2 },
              emphasis: { focus: 'series' },
              data: pairs(s.t, s.PM10), markLine: stdLine('PM10'),
            },
          ],
        },
        true
      );
    }

    // ---- small multiples ----------------------------------------------------
    renderMultiples('gasCharts', GAS, d, t, unitOf);

    renderWindRose(d, t);
    renderHeatmap(d, t);
  }

  function renderMultiples(containerId, names, d, t, unitOf) {
    const box = $(containerId);
    const present = names.filter((n) => d.series[n]);
    const key = present.join('|');
    if (box.dataset.key !== key) {
      box.innerHTML = present
        .map((n) => `
          <article class="panel">
            <div class="mini-head">
              <h3>${CH[n].th}${CH[n].short ? ` (${CH[n].short})` : ''}</h3>
              <span id="mini-last-${n.replace('.', '')}"></span>
            </div>
            <div id="mini-${n.replace('.', '')}" class="chart chart-sm"></div>
          </article>`)
        .join('');
      box.dataset.key = key;
    }

    present.forEach((n) => {
      const id = `mini-${n.replace('.', '')}`;
      const c = chart(id);
      if (!c) return;
      const vals = d.series[n];
      const lastIdx = vals.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
      const unit = unitOf[n] || '';
      $(`mini-last-${n.replace('.', '')}`).textContent =
        lastIdx !== undefined ? `ล่าสุด ${fmt(vals[lastIdx], CH[n].dp)} ${unit}` : 'ไม่มีข้อมูล';

      c.setOption(
        {
          animation: false,
          textStyle: { fontFamily: t.font },
          grid: { left: 40, right: 8, top: 10, bottom: 22 },
          tooltip: tooltip(t, CH[n].dp, unit),
          xAxis: timeAxis(t, d.days),
          yAxis: valueAxis(t, ZERO_BASED.has(n)),
          series: [
            {
              name: CH[n].th, type: 'line', showSymbol: false, connectNulls: false,
              lineStyle: { width: 2, color: t.s1 }, itemStyle: { color: t.s1 },
              // พื้นที่ใต้เส้นใช้เฉพาะกราฟที่แกนเริ่มจากศูนย์ ถ้าแกนไม่เริ่มศูนย์
              // พื้นที่จะดึงแกนลงไปหาศูนย์จนเส้นแบน
              areaStyle: ZERO_BASED.has(n) ? { color: t.s1, opacity: 0.06 } : undefined,
              data: pairs(d.series.t, vals),
            },
          ],
        },
        true
      );
    });
  }

  function renderWindRose(d, t) {
    const c = chart('windChart');
    const w = d.windRose;
    if (!c || !w) return;
    const ramp = isDark() ? ['#184f95', '#2a78d6', '#6da7ec', '#b7d3f6'] : ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
    const thaiSector = { N: 'N', E: 'E', S: 'S', W: 'W' };
    $('windNote').textContent = w.hours ? `${w.hours} ชม. · ลมสงบ (< 0.5 m/s) ${fmt(w.calmPct, 1)}%` : 'ไม่มีข้อมูลลม';

    c.setOption(
      {
        animation: false,
        textStyle: { fontFamily: t.font },
        polar: { radius: ['6%', '72%'], center: ['50%', '48%'] },
        angleAxis: {
          type: 'category',
          data: w.sectors,
          startAngle: 90 + 11.25,
          boundaryGap: true,
          axisLine: { lineStyle: { color: t.line } },
          axisTick: { show: false },
          axisLabel: { color: t.text3, formatter: (v) => thaiSector[v] || (v.length === 2 ? v : '') },
          splitLine: { show: true, lineStyle: { color: t.grid } },
        },
        radiusAxis: {
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.text3, formatter: '{value}%', fontSize: 10 },
          splitLine: { lineStyle: { color: t.grid } },
        },
        tooltip: {
          trigger: 'item',
          backgroundColor: t.surface,
          borderColor: t.line,
          textStyle: { color: t.text, fontFamily: t.font },
          formatter: (p) => `ทิศ ${p.name}<br>${p.seriesName} m/s: <b>${fmt(p.value, 1)}%</b>`,
        },
        legend: {
          bottom: 0,
          itemWidth: 12,
          itemHeight: 12,
          textStyle: { color: t.text2 },
          data: w.bins.map((b) => `${b} m/s`),
        },
        series: w.bins.map((b, i) => ({
          type: 'bar',
          name: `${b} m/s`,
          coordinateSystem: 'polar',
          stack: 'wind',
          data: w.pct[i],
          itemStyle: { color: ramp[i], borderColor: t.surface, borderWidth: 1 },
          emphasis: { focus: 'series' },
        })),
      },
      true
    );
  }

  function renderHeatmap(d, t) {
    const c = chart('heatChart');
    const h = d.diurnal;
    if (!c || !h) return;
    const days = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
    // ลงสีตามช่วง PM2.5 ของ TH AQI ใช้สีชุดเดียวกับการ์ด AQI ด้านบน (ยึดตาม pm2_5.nrct.go.th)
    // ช่องแต่ละช่องเป็นค่าเฉลี่ยรายชั่วโมง ส่วนเกณฑ์ทางการเป็นค่าเฉลี่ย 24 ชม. จึงใช้เพื่อเทียบระดับเท่านั้น
    const PM25_PIECES = [
      { gte: 0, lte: 15, label: '0–15 ดีมาก', band: 0 },
      { gt: 15, lte: 25, label: '15.1–25 ดี', band: 1 },
      { gt: 25, lte: 37.5, label: '25.1–37.5 ปานกลาง', band: 2 },
      { gt: 37.5, lte: 75, label: '37.6–75 มีผลกระทบ', band: 3 },
      { gt: 75, label: '>75 มีผลกระทบมาก', band: 4 },
    ].map((p) => ({ ...p, color: AQI_BANDS[p.band].color }));
    $('heatLegend').innerHTML = PM25_PIECES.map(
      (p) => `<span><i class="sw" style="background:${p.color}"></i>${p.label}</span>`
    ).join('');

    const levelOf = (v) => {
      const p = PM25_PIECES.find((x) => (x.gte !== undefined ? v >= x.gte : v > x.gt) && (x.lte === undefined || v <= x.lte));
      return p ? AQI_BANDS[p.band].label : '';
    };

    c.setOption(
      {
        animation: false,
        textStyle: { fontFamily: t.font },
        grid: { left: 36, right: 12, top: 8, bottom: 28 },
        tooltip: {
          backgroundColor: t.surface,
          borderColor: t.line,
          textStyle: { color: t.text, fontFamily: t.font },
          formatter: (p) =>
            `วัน${days[p.value[1]].replace('.', '')} เวลา ${String(p.value[0]).padStart(2, '0')}:00<br>PM2.5 เฉลี่ย <b>${fmt(p.value[2], 1)} µg/m³</b><br>${levelOf(p.value[2])}<br><span style="color:${t.text3}">จาก ${p.value[3]} ชั่วโมง</span>`,
        },
        xAxis: {
          type: 'category',
          data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.text3, interval: 2 },
          splitArea: { show: false },
        },
        yAxis: {
          type: 'category',
          data: days,
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.text3 },
        },
        visualMap: {
          // แต่ละช่องเก็บ [ชั่วโมง, วัน, ค่าเฉลี่ย, จำนวนชั่วโมง] ต้องระบุว่าลงสีจากมิติที่ 2 (ค่าเฉลี่ย)
          dimension: 2,
          type: 'piecewise',
          pieces: PM25_PIECES.map(({ band, ...p }) => p),
          // คำอธิบายสีทำเป็น HTML ใต้กราฟแทน เพราะของ ECharts ไม่ตัดบรรทัดบนจอมือถือ
          show: false,
        },
        series: [
          {
            type: 'heatmap',
            data: h.cells,
            itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
            emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } },
          },
        ],
      },
      true
    );
  }

  /* ---------------------------------------------------------------- table */

  function tableRows(d) {
    const names = d.channels.map((c) => c.name);
    const header = ['เวลา', ...d.channels.map((c) => `${c.name} (${unitFor(c.name, c.unit)})`)];
    const rows = d.series.t.map((t, i) => [
      new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16),
      ...names.map((n) => (d.series[n] ? conv(n, d.series[n][i]) : null)),
    ]);
    return { header, rows, names };
  }

  function renderTable(d) {
    const { header, rows, names } = tableRows(d);
    const dp = names.map((n) => (CH[n] ? CH[n].dp : 2));
    const body = rows
      .slice()
      .reverse()
      .map((r) => `<tr>${r.map((v, i) => `<td>${i === 0 ? v : fmt(v, dp[i - 1])}</td>`).join('')}</tr>`)
      .join('');
    $('dataTable').innerHTML = `<thead><tr>${header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
  }

  function downloadCsv() {
    const d = state.data;
    if (!d) return;
    const { header, rows } = tableRows(d);
    const esc = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${d.station || 'envidas'}_${d.days}d_${d.resolution}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  /* ================================================================ wiring */

  function setRange(days) {
    state.days = days;
    document.querySelectorAll('#rangeControl button').forEach((b) => {
      const on = Number(b.dataset.days) === days;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    try { localStorage.setItem('envidas.days', String(days)); } catch (e) { /* ไม่มี storage ก็ไม่เป็นไร */ }
    const snap = loadSnapshot(days);
    if (snap) {
      state.data = snap;
      render();
    }
    load();
  }

  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    let saved = 7;
    try { saved = Number(localStorage.getItem('envidas.days')) || 7; } catch (e) { /* ignore */ }
    if (![1, 7, 30, 90, 365].includes(saved)) saved = 7;
    state.days = saved;
    document.querySelectorAll('#rangeControl button').forEach((b) => {
      const on = Number(b.dataset.days) === saved;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => setRange(Number(b.dataset.days)));
    });

    $('refreshBtn').addEventListener('click', load);
    $('csvBtn').addEventListener('click', downloadCsv);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.data && Date.now() - (state.lastLoadAt || 0) > REFRESH_MS) load();
    });
    setInterval(renderFreshness, 15_000);

    // สลับโหมดมืด/สว่างแล้ววาดกราฟใหม่ด้วยสีของโหมดนั้น
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.data && render());

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => Object.values(state.charts).forEach((c) => c.resize()), 120);
    });

    const snap = loadSnapshot(state.days);
    if (snap) {
      state.data = snap;
      render();
    }
    load();
    schedule();
  });
})();
