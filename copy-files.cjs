const ncp = require('ncp').ncp;
const path = require('path');

ncp(path.join(__dirname, 'src/dashboard'), path.join(__dirname, 'dist/dashboard'), function (err) {
  if (err) {
    return console.error(err);
  }
  console.log('> 构建完成');
});
