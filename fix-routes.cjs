const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('packages/gateway/src/routes', function(filePath) {
  if (!filePath.endsWith('.ts')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  if (!content.includes('LOCAL_OWNER_ID')) return;
  
  content = content.replace(/(const|let)\s+userId\s*=\s*LOCAL_OWNER_ID;/g, '$1 userId = getUserId(c);');
  
  if (!content.includes('getUserId')) {
    if (content.match(/import\s+\{[^}]*\}\s+from\s+['"].*helpers\.js['"];/)) {
      content = content.replace(/(import\s+\{[^}]*)(\}\s+from\s+['"].*helpers\.js['"];)/, '$1, getUserId $2');
    } else {
      const parts = filePath.split(path.sep);
      const routesIndex = parts.indexOf('routes');
      const depth = parts.length - routesIndex - 2;
      const prefix = depth === 0 ? './' : '../'.repeat(depth);
      content = `import { getUserId } from '${prefix}helpers.js';\n` + content;
    }
  }
  
  if (!content.match(/LOCAL_OWNER_ID(?!.*import)/)) {
    content = content.replace(/,\s*LOCAL_OWNER_ID\b|\bLOCAL_OWNER_ID\s*,\s*|\bLOCAL_OWNER_ID\b/g, '');
    content = content.replace(/import\s*\{\s*\}\s*from\s*['"][^'"]+['"];\n?/g, '');
  }
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log('Fixed ' + filePath);
  }
});
