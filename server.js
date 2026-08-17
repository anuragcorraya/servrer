const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// HTML ফাইলটি সার্ভ করার জন্য
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
