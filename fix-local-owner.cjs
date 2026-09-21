const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    if (fs.statSync(dirPath).isDirectory()) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

walkDir('packages/gateway/src/routes', function(filePath) {
  if (!filePath.endsWith('.ts')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  if (content.includes('userId = LOCAL_OWNER_ID') || content.includes('userId: LOCAL_OWNER_ID') || content.includes('workspaceId: LOCAL_WORKSPACE_ID')) {
    
    // Replace assignments
    content = content.replace(/userId\s*=\s*LOCAL_OWNER_ID/g, 'userId = getUserId(c)');
    
    // Replace object property assignments
    content = content.replace(/userId:\s*LOCAL_OWNER_ID/g, 'userId: getUserId(c)');
    
    // Replace workspaceId assignments
    content = content.replace(/workspaceId\s*=\s*LOCAL_WORKSPACE_ID/g, 'workspaceId = getWorkspaceId(c)');
    content = content.replace(/workspaceId:\s*LOCAL_WORKSPACE_ID/g, 'workspaceId: getWorkspaceId(c)');
    content = content.replace(/LOCAL_WORKSPACE_ID/g, 'getWorkspaceId(c)'); // Catch any other usages
    
    content = content.replace(/LOCAL_OWNER_ID/g, 'getUserId(c)'); // Catch any other usages
    
    // Calculate prefix for imports
    const parts = filePath.split(path.sep);
    const routesIndex = parts.indexOf('routes');
    const depth = parts.length - routesIndex - 2;
    const prefix = depth === 0 ? './' : '../'.repeat(depth);
    
    // Prepend imports
    if (!content.includes('getUserId(c)')) {
       // Should not happen, but just in case
    }
    
    content = `import { getUserId, getWorkspaceId } from '${prefix}helpers.js';\n` + content;
    
    fs.writeFileSync(filePath, content);
    console.log('Fixed ' + filePath);
  }
});
