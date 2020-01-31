const path = require('path');
const fs = require('fs');
const file = path.join(__dirname, '../../package.json');
const packageInfo = JSON.parse(fs.readFileSync(file, { encoding: 'utf8' }));
console.log(packageInfo.version);