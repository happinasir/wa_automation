const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;

// Environment Variables
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Google Sheet Connection Function
async function appendToSheet(phone, message, name) {
  try {
    const serviceAccountAuth = new JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
    await doc.loadInfo(); 
    
    const sheet = doc.sheetsByIndex[0];
    
    // 🔴 تبدیلی: اب یہ آپ کی شیٹ کے ہیڈرز کے مطابق ہے
    await sheet.addRow({ 
      Time: new Date().toLocaleString(), // 'Date' کی جگہ 'Time'
      Name: name, 
      Phone: phone,                      // 'From' کی جگہ 'Phone'
      Type: 'text',                      // یہ نیا کالم ہے
      Message: message 
    });
    
    console.log('Row added to sheet!');
  } catch (error) {
    console.error('Sheet Error:', error);
  }
}

// GET Route (Verification)
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// POST Route (Incoming Messages)
app.post('/', async (req, res) => {
  res.status(200).end();

  try {
    const body = req.body;
    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        
        const messageData = body.entry[0].changes[0].value.messages[0];
        const contactData = body.entry[0].changes[0].value.contacts[0];
        
        const senderPhone = messageData.from;
        const senderName = contactData.profile.name;
        
        if (messageData.type === 'text') {
          const textMessage = messageData.text.body;
          console.log(`New Message from ${senderName}: ${textMessage}`);
          
          await appendToSheet(senderPhone, textMessage, senderName);
        }
      }
    }
  } catch (e) {
    console.log('Error parsing message:', e);
  }
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
