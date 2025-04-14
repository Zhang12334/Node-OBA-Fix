const fs = require('fs');
const path = require('path');
const ncp = require('ncp').ncp;

function updatePackageJson() {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.error('> 找不到 package.json');
      process.exit(1);
    }

    const packageJson = require(packageJsonPath);

    packageJson.dev = true;
    
    // 更新
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2) + '\n', // 保持格式化和换行
      'utf8'
    );
      
    console.log('> 写入 Dev 版标记符成功');
  } catch (error) {
    console.error('> 写入 Dev 版标记符失败: ', error.message);
    process.exit(1);
  }
}

ncp(path.join(__dirname, 'src/dashboard'), path.join(__dirname, 'dist/dashboard'), function (err) {
  if (err) {
    return console.error(err);
  }
  console.log('> 构建完成');
});

updatePackageJson();