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
  
  // Remove LOCAL_OWNER_ID unused imports completely
  content = content.replace(/import\s*\{\s*LOCAL_OWNER_ID\s*\}\s*from\s*['"].*defaults\.js['"];\n?/g, '');
  content = content.replace(/,\s*LOCAL_OWNER_ID\b/g, '');
  content = content.replace(/\bLOCAL_OWNER_ID\s*,\s*/g, '');

  if (content.includes('getUserId(') && !content.includes('getUserId }') && !content.includes('{ getUserId }') && !content.includes('{getUserId}')) {
    if (content.match(/import\s+\{[^}]*\}\s+from\s+['"].*helpers\.js['"];/)) {
      content = content.replace(/(import\s+\{[^}]*)(\}\s+from\s+['"].*helpers\.js['"];)/, '$1, getUserId $2');
    } else {
      const parts = filePath.split(path.sep);
      const routesIndex = parts.indexOf('routes');
      const depth = parts.length - routesIndex - 2;
      const prefix = depth === 0 ? './' : '../'.repeat(depth);
      content = `import { getUserId } from '${prefix}helpers.js';\n` + content;
    }
    fs.writeFileSync(filePath, content);
    console.log('Fixed imports in ' + filePath);
  } else if (content !== fs.readFileSync(filePath, 'utf8')) {
    fs.writeFileSync(filePath, content);
  }
});
