const fs = require('fs');
const ncp = require('ncp').ncp;
const path = require('path');

function updatePackageJson() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.error('> 找不到 package.json');
      process.exit(1);
    }

    const packageJson = require(packageJsonPath);

    if (packageJson.dev !== undefined) {
      // 只清除 dev 字段
      delete packageJson.dev;
      
      // 更新 package.json
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2) + '\n',
        'utf8'
      );
      
      console.log('> 已清除 Dev 版标记符');
    }
  } catch (error) {
    console.error('> 清除 Dev 版标记符失败: ', error.message);
    process.exit(1);
  }
}

updatePackageJson();

ncp(path.join(__dirname, 'src/dashboard'), path.join(__dirname, 'dist/dashboard'), function (err) {
  if (err) {
    return console.error(err);
  }
  console.log('> 构建完成');
});