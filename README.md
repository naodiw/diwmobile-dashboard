# Envidas Dashboard

หน้าแสดงข้อมูลคุณภาพอากาศจากรถตรวจวัดเคลื่อนที่ (สถานี DIW_Chiangmai) บน GitHub Pages

```
Envidas SQL -> envidas-to-sheets (Node) -> Google Sheet -> envidas-appscript (Web App, JSONP) -> หน้านี้
```

- ตั้งค่า URL ของ Apps Script ที่ `window.ENVIDAS_API` ใน `index.html`
- AQI คำนวณตามเกณฑ์ TH AQI ของ https://pm2_5.nrct.go.th/definition
- พรีวิวบนเครื่องด้วยข้อมูลตัวอย่าง: `node serve-dev.js` แล้วเปิด `http://localhost:8765/?mock=1`
  (ไฟล์ตัวอย่างสร้างด้วย `node test-local.js --dump <โฟลเดอร์>/dev` ใน repo envidas-appscript)
