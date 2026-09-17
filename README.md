# Envidas Dashboard

หน้าแสดงข้อมูลคุณภาพอากาศจากรถตรวจวัดเคลื่อนที่ (สถานี DIW_Chiangmai) บน GitHub Pages

```
Envidas SQL -> envidas-to-sheets (Node) -> Google Sheet -> envidas-appscript (Web App) -> Cloudflare Worker (แคช) -> หน้านี้
```

- ตั้งค่า URL ที่ `index.html`: `window.ENVIDAS_CACHE_API` (Worker ทางหลัก) และ `window.ENVIDAS_API` (Apps Script ทางสำรอง)
- AQI คำนวณตามเกณฑ์ TH AQI ของ https://pm2_5.nrct.go.th/definition
- Heatmap PM2.5 แบบหน้า T640: เลือกดู วัน / สัปดาห์ / เดือน / ปี ตามปฏิทิน (ใช้ `pm25Hourly` จาก API, เวลาเป็นเวลาสิ้นสุดชั่วโมง, ช่องไม่มีข้อมูลสีเทา, สีตาม TH AQI) ถ้าช่วงที่โหลดอยู่ไม่ครอบคลุมจะโหลดชุด 1 ปีมาใช้
- พรีวิวบนเครื่องด้วยข้อมูลตัวอย่าง: `node serve-dev.js` แล้วเปิด `http://localhost:8765/?mock=1`
  (ไฟล์ตัวอย่างสร้างด้วย `node test-local.js --dump <โฟลเดอร์>/dev` ใน repo envidas-appscript)
