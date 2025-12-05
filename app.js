const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---------------------------------------------------------
// 1. CONFIGURATION (سیٹنگز)
// ---------------------------------------------------------
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY || "";
const GOOGLE_PRIVATE_KEY = privateKeyRaw.replace(/\\n/g, '\n');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ---------------------------------------------------------
// 2. MEMORY (عارضی میموری)
// ---------------------------------------------------------
const userState = {}; 
// ✅ Name Cache کی ضرورت ختم کر دی گئی ہے، لیکن اب بھی یوزر کا نام محفوظ کرنے کے لیے ایک متغیر استعمال ہو گا۔
const nameCacheStore = {}; 

// ---------------------------------------------------------
// 3. GOOGLE SHEET FUNCTION (ڈیٹا سیونگ logic)
// ---------------------------------------------------------
async function appendToSheet(data) {
  console.log("📝 Attempting to save to Google Sheet...");
  try {
    const serviceAccountAuth = new JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    // Headers updated: Complaint Type is used
    await sheet.addRow({
      "Time": data.date,
      "Name": data.customerName,
      "Phone": data.phone,
      "Complaint Type": data.category,
      "Salesman Name": data.salesman,
      "Shop Name": data.shop,
      "Address": data.address,
      "Complaint Message": data.complaint 
    });

    console.log('✅ Data SAVED successfully!');
  } catch (error) {
    console.error('❌ Error saving to sheet:', error.message);
  }
}

// ---------------------------------------------------------
// 4. WHATSAPP SEND FUNCTION
// ---------------------------------------------------------
async function sendReply(to, bodyText) {
  console.log(`📤 Sending message to ${to}: ${bodyText.substring(0, 20)}...`);
  try {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: {
        messaging_product: 'whatsapp',
        to: to,
        text: { body: bodyText },
      },
    });
    console.log("✅ Message sent successfully!");
  } catch (error) {
    console.error('❌ Error sending message:', error.response ? JSON.stringify(error.response.data) : error.message);
  }
}

// ---------------------------------------------------------
// 5. WEBHOOK LOGIC
// ---------------------------------------------------------
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
    console.log("✅ Webhook Verified Successfully!");
    res.send(req.query['hub.challenge']);
  } else {
    console.error("❌ Webhook Verification Failed. Token mismatch.");
    res.sendStatus(400);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log("📨 Incoming Webhook:", JSON.stringify(body, null, 2));

    if (body.object) {
        if (
            body.entry &&
            body.entry[0].changes &&
            body.entry[0].changes[0].value.messages &&
            body.entry[0].changes[0].value.messages[0]
        ) {
          const message = body.entry[0].changes[0].value.messages[0];
          const senderPhone = message.from;
          
          // اب ہم یہاں سے نام نہیں لیں گے، بلکہ یوزر سے پوچھیں گے
          // const nameFromPayload = message.contacts ? message.contacts[0].profile.name : null;

          if (message.type !== 'text') {
            console.log("⚠️ Received non-text message. Ignoring.");
            return;
          }
          
          const textMessage = message.text.body.trim();
          const lowerText = textMessage.toLowerCase();

          if (!userState[senderPhone]) {
              userState[senderPhone] = { step: 'START', data: {} };
          }
          
          const currentUser = userState[senderPhone];
          
          // 2. Name Cache Logic - یوزر کے ان پٹ سے نام سیٹ ہو گا
          let senderName = currentUser.data.customerName || "Unknown";
          
          console.log(`👤 User: ${senderName} (${senderPhone}) says: "${textMessage}"`);

          // ---------------- LOGIC ----------------

          // 1. Greeting / Reset
          if (lowerText.includes("salam") || lowerText.includes("hi") || lowerText.includes("hello") || lowerText.includes("hy")) {
              console.log("🚀 Detected Greeting. Sending Menu...");
              
              userState[senderPhone].step = 'START';
              // customerName کو ری سیٹ کریں تاکہ دوبارہ پوچھا جائے
              delete userState[senderPhone].data.customerName; 
              
              const menuText = `خوش آمدید! 🌹
ہماری کسٹمر سپورٹ سروس میں آپ کا استقبال ہے۔

براہِ کرم مطلوبہ آپشن کا اندراج کریں:

1️⃣. سیل مین سے متعلق شکایت
2️⃣. ڈسٹری بیوٹر سے متعلق شکایت
3️⃣. سٹاک کی کوالٹی/ قیمت یا بل کے متعلق شکایت
4️⃣. سٹاک آرڈر`;

              await sendReply(senderPhone, menuText);
          }
          
          // 2. Menu Selection (1-4)
          else if (currentUser.step === 'START') {
              
              if (['1', '2', '3', '4'].includes(textMessage)) {
                  let category = '';
                  
                  if (textMessage === '1') category = 'Salesman Complaint';
                  if (textMessage === '2') category = 'Distributor Complaint';
                  if (textMessage === '3') category = 'Quality/Price/Bill';
                  if (textMessage === '4') category = 'Stock Order';

                  currentUser.data.category = category;
                  
                  // ✅ نیا سٹیپ: نام پوچھنا
                  currentUser.step = 'ASK_NAME'; 
                  
                  await sendReply(senderPhone, "شکریہ۔ براہ کرم اپنا پورا نام لکھیں۔");
                  
              } else {
                  await sendReply(senderPhone, "براہ کرم مینو میں سے درست نمبر (1, 2, 3 یا 4) کا انتحاب کریں۔");
              }
          }
          
          // ✅ نیا سٹیپ: صارف کا نام محفوظ کرنا
          else if (currentUser.step === 'ASK_NAME') {
              currentUser.data.customerName = textMessage;
              currentUser.step = 'ASK_SALESMAN';
              // اب یہ ASK_SALESMAN والے سٹیپ پر جائے گا
              await sendReply(senderPhone, "شکریہ! اب براہ کرم سیلز مین کا نام لکھیں۔");
          }


          // 3. Ask Shop (پچھلا ASK_SALESMAN تھا)
          else if (currentUser.step === 'ASK_SALESMAN') {
              currentUser.data.salesman = textMessage;
              currentUser.step = 'ASK_SHOP';
              await sendReply(senderPhone, "شکریہ! دکان کا نام لکھیں۔");
          }

          // 4. Ask Address
          else if (currentUser.step === 'ASK_SHOP') {
              currentUser.data.shop = textMessage;
              currentUser.step = 'ASK_ADDRESS';
              await sendReply(senderPhone, "اب دکان کا ایڈریس لکھیں۔");
          }

          // 5. Ask Details
          else if (currentUser.step === 'ASK_ADDRESS') {
              currentUser.data.address = textMessage;
              currentUser.step = 'ASK_COMPLAINT';
              await sendReply(senderPhone, "شکریہ۔ آخر میں اپنی شکایت تفصیل سے لکھیں۔");
          }

          // 6. Finish (Final Confirmation)
          else if (currentUser.step === 'ASK_COMPLAINT') {
              currentUser.data.complaint = textMessage;
              
              const category = currentUser.data.category;
              let contactInfo = "";

              // رابطہ نمبر کی شرط شامل کی گئی
              if (category === 'Distributor Complaint') {
                  contactInfo = `
*محمد اعجاز شیخ* 03338033113`;
              } else {
                  // Option 1, 3, اور 4 کے لیے
                  contactInfo = `
*شیخ محمد مسعود* 03007753113`;
              }

              // ✅ آخری سمری میسج
              const finalConfirmation = `
*آپ کا ڈیٹا سسٹم میں درج کر لیا گیا ہے*
----------------------------------------
آپ کا نام: ${currentUser.data.customerName}
سیل مین کا نام: ${currentUser.data.salesman}
دکان کا نام: ${currentUser.data.shop}
دکان کا ایڈریس: ${currentUser.data.address}
شکایت: ${category}
---
بہت جلد آپ سے رابطہ کر لیا جائے گا۔ شکریہ! 🌹
${contactInfo}
              `.trim();

              const finalData = {
                  date: new Date().toLocaleString(),
                  category: category || 'N/A (Flow Break)', 
                  customerName: currentUser.data.customerName || "N/A", // یہاں سے نام بھیجیں
                  phone: senderPhone,
                  salesman: currentUser.data.salesman,
                  shop: currentUser.data.shop,
                  address: currentUser.data.address,
                  complaint: currentUser.data.complaint
              };

              await sendReply(senderPhone, finalConfirmation);
              
              await appendToSheet(finalData);
              delete userState[senderPhone];
          }

        }
    }
  } catch (e) {
    console.error('❌ SYSTEM ERROR:', e);
  }
});

// ---------------------------------------------------------
// 6. START SERVER
// ---------------------------------------------------------
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
