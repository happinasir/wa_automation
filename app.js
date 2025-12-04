const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const axios = require('axios');

const app = express();
app.use(express.json());

constport: process.env.PORT || 3000, host: '0.0.0.0';
const verifyToken = process.env.VERIFY_TOKEN;

// Environment Variables
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// 🧠 MEMORY (یہاں یوزر کا عارضی ڈیٹا سیو ہوگا)
const userState = {}; 

// 1. Message Sending Function
async function sendReply(toPhone, text) {
  try {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text }
      }
    });
  } catch (e) {
    console.error('Error sending reply:', e.message);
  }
}

// 2. Google Sheet Function (Writes FULL ROW at the end)
async function appendToSheet(data) {
  try {
    const serviceAccountAuth = new JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); 
    const sheet = doc.sheetsByIndex[0];
    
    // شیٹ میں ڈیٹا ایڈ کریں
    await sheet.addRow({ 
      'Time': new Date().toLocaleString(),
      'Customer Name': data.customerName, 
      'Phone': data.phone,
      'Salesman Name': data.salesman,
      'Shop Name': data.shop,
      'Address': data.address,
      'Complaint Message': data.complaint
    });
    
    console.log('Full Complaint added to sheet!');
  } catch (error) {
    console.error('Sheet Error:', error);
  }
}

// Routes
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

app.post('/', async (req, res) => {
  res.status(200).end();

  try {
    const body = req.body;
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        
        const messageData = body.entry[0].changes[0].value.messages[0];
        const contactData = body.entry[0].changes[0].value.contacts[0];
        
        const senderPhone = messageData.from;
        const senderName = contactData.profile.name;
        
        if (messageData.type === 'text') {
          const textMessage = messageData.text.body;
          const lowerText = textMessage.toLowerCase().trim();
          
          console.log(`Msg from ${senderName}: ${textMessage}`);

          // --- STATE MANAGEMENT LOGIC ---

          // چیک کریں کہ کیا یوزر کا کوئی پرانا ریکارڈ میموری میں ہے؟
          if (!userState[senderPhone]) {
              userState[senderPhone] = { step: 'START', data: {} };
          }

          const currentUser = userState[senderPhone];

          // 🛑 CASE 1: یوزر نے "1" دبایا (Start Complaint)
          if (textMessage === "1" && currentUser.step === 'START') {
              currentUser.step = 'ASK_SALESMAN';
              await sendReply(senderPhone, "برائے مہربانی **Salesman Name** (سیلز مین کا نام) لکھ کر بھیجیں۔");
          }

          // 🛑 CASE 2: سیلز مین کا نام آیا -> دکان کا نام پوچھیں
          else if (currentUser.step === 'ASK_SALESMAN') {
              currentUser.data.salesman = textMessage; // نام سیو کر لیا
              currentUser.step = 'ASK_SHOP';
              await sendReply(senderPhone, "شکریہ۔ اب **Shop Name** (دکان کا نام) لکھیں۔");
          }

          // 🛑 CASE 3: دکان کا نام آیا -> ایڈریس پوچھیں
          else if (currentUser.step === 'ASK_SHOP') {
              currentUser.data.shop = textMessage;
              currentUser.step = 'ASK_ADDRESS';
              await sendReply(senderPhone, "شکریہ۔ اب دکان کا **Address** (پتہ) لکھیں۔");
          }

          // 🛑 CASE 4: ایڈریس آیا -> شکایت پوچھیں
          else if (currentUser.step === 'ASK_ADDRESS') {
              currentUser.data.address = textMessage;
              currentUser.step = 'ASK_COMPLAINT';
              await sendReply(senderPhone, "شکریہ۔ آخر میں اپنی **Complaint** (شکایت) تفصیل سے لکھ کر بھیجیں۔");
          }

          // 🛑 CASE 5: شکایت آئی -> شیٹ میں لکھیں اور ختم کریں (FINISH)
          else if (currentUser.step === 'ASK_COMPLAINT') {
              currentUser.data.complaint = textMessage;
              
              // ڈیٹا شیٹ کے فنکشن کو بھیجیں (اضافی معلومات بھی)
              const finalData = {
                  customerName: senderName,
                  phone: senderPhone,
                  salesman: currentUser.data.salesman,
                  shop: currentUser.data.shop,
                  address: currentUser.data.address,
                  complaint: currentUser.data.complaint
              };

              await sendReply(senderPhone, "آپ کا بہت شکریہ! 🌹\nآپ کی شکایت ہمارے سسٹم میں درج کر لی گئی ہے۔ ہماری ٹیم جلد کارروائی کرے گی۔");
              
              // 📝 شیٹ میں لکھیں
              await appendToSheet(finalData);

              // 🗑️ میموری صاف کریں (تاکہ اگلی بار نئی شکایت لکھ سکے)
              delete userState[senderPhone];
          }

          // 🛑 CASE 6: اگر یوزر "Salam" یا "Hi" بھیجے (کسی بھی وقت)
          else if (lowerText.includes("salam") || lowerText.includes("hi") || lowerText.includes("hello") || lowerText.includes("hy")) {
              // اگر یوزر بیچ میں پھنس گیا ہو تو اسے ری سیٹ کر دیں
              userState[senderPhone] = { step: 'START', data: {} };
              
              await sendReply(senderPhone, "خوش آمدید! 🌹\nشکایت درج کروانے کے لیے **1** لکھ کر بھیجیں۔");
          }

          // 🛑 CASE 7: اگر کوئی غلط میسج بھیجے
          else {
             // اگر یوزر کسی پروسیس میں نہیں ہے تو اسے گائیڈ کریں
             if (currentUser.step === 'START') {
                 await sendReply(senderPhone, "شکایت درج کروانے کے لیے **1** لکھ کر بھیجیں۔");
             }
          }
        }
    }
  } catch (e) {
    console.log('Error:', e);
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
