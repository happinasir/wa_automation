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
          
          const nameFromPayload = message.contacts ? message.contacts[0].profile.name : null;

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
          
          // 2. Name Cache Logic
          let senderName = "Unknown";
          
          if (nameFromPayload) {
              senderName = nameFromPayload;
              nameCacheStore[senderPhone] = nameFromPayload;
          } else if (nameCacheStore[senderPhone]) {
              senderName = nameCacheStore[senderPhone];
          }
          
          console.log(`👤 User: ${senderName} (${senderPhone}) says: "${textMessage}"`);

          // ---------------- LOGIC ----------------

          // 1. Greeting / Reset (FIXED: Does not reset if waiting for final complaint detail)
          if ((lowerText.includes("salam") || lowerText.includes("hi") || lowerText.includes("hello") || lowerText.includes("hy")) && currentUser.step !== 'ASK_COMPLAINT') {
              console.log("🚀 Detected Greeting. Sending Menu...");
              
              userState[senderPhone].step = 'START';
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
                  
                  currentUser.step = 'ASK_NAME'; // Go to the user name prompt
                  
                  await sendReply(senderPhone, "شکریہ۔ براہ کرم اپنا نام لکھیں۔");
                  
              } else {
                  await sendReply(senderPhone, "براہ کرم مینو میں سے درست نمبر (1, 2, 3 یا 4) کا انتحاب کریں۔");
              }
          }
          
          // 2.5 ASK_NAME Step
          else if (currentUser.step === 'ASK_NAME') {
              currentUser.data.customerName = textMessage;
              currentUser.step = 'ASK_SALESMAN';
              await sendReply(senderPhone, "سیلز مین کا نام لکھیں۔");
          }


          // 3. Ask Shop
          else if (currentUser.step === 'ASK_SALESMAN') {
              currentUser.data.salesman = textMessage;
              currentUser.step = 'ASK_SHOP';0
              await sendReply(senderPhone, "دکان کا نام لکھیں۔");
          }

          // 4. Ask Address
          else if (currentUser.step === 'ASK_SHOP') {
              currentUser.data.shop = textMessage;
              currentUser.step = 'ASK_ADDRESS';
              await sendReply(senderPhone, "دکان کا ایڈریس لکھیں۔");
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

              // رابطہ نمبر کی شرط
              if (category === 'Distributor Complaint') {
                  contactInfo = `
*Director: محمد اعجاز شیخ*
Mob: 0333-8033113`;
              } else {
                  contactInfo = `
*DM: شیخ محمد مسعود*
Mob: 0300-7753113`;
              }

              // آخری سمری میسج
              const finalConfirmation = `
*آپ کا ڈیٹا سسٹم میں درج کر لیا گیا ہے*
----------------------------------------
سیل مین کا نام: ${currentUser.data.salesman}
دکان کا نام: ${currentUser.data.shop}
دکان کا ایڈریس: ${currentUser.data.address}
شکایت: ${category}
بہت جلد آپ سے رابطہ کر لیا جائے گا۔ شکریہ! 🌹
${contactInfo}
              `.trim();

              const finalData = {
                  date: new Date().toLocaleString(),
                  category: category || 'N/A (Flow Break)', 
                  customerName: currentUser.data.customerName || senderName,
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
