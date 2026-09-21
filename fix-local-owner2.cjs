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
  
  if (content.includes('LOCAL_OWNER_ID') || content.includes('LOCAL_WORKSPACE_ID')) {
    
    // First, remove LOCAL_OWNER_ID and LOCAL_WORKSPACE_ID from imports to avoid mangling them
    content = content.replace(/import\s*\{\s*LOCAL_OWNER_ID\s*\}\s*from\s*['"][^'"]+['"];\n?/g, '');
    content = content.replace(/import\s*\{\s*LOCAL_WORKSPACE_ID\s*\}\s*from\s*['"][^'"]+['"];\n?/g, '');
    content = content.replace(/import\s*\{\s*LOCAL_OWNER_ID\s*,\s*LOCAL_WORKSPACE_ID\s*\}\s*from\s*['"][^'"]+['"];\n?/g, '');
    content = content.replace(/,\s*LOCAL_OWNER_ID\b/g, '');
    content = content.replace(/\bLOCAL_OWNER_ID\s*,\s*/g, '');
    content = content.replace(/,\s*LOCAL_WORKSPACE_ID\b/g, '');
    content = content.replace(/\bLOCAL_WORKSPACE_ID\s*,\s*/g, '');
    
    // Replace assignments
    content = content.replace(/userId\s*=\s*LOCAL_OWNER_ID/g, 'userId = getUserId(c)');
    
    // Replace object property assignments
    content = content.replace(/userId:\s*LOCAL_OWNER_ID/g, 'userId: getUserId(c)');
    
    // Replace workspaceId assignments
    content = content.replace(/workspaceId\s*=\s*LOCAL_WORKSPACE_ID/g, 'workspaceId = getWorkspaceId(c)');
    content = content.replace(/workspaceId:\s*LOCAL_WORKSPACE_ID/g, 'workspaceId: getWorkspaceId(c)');
    
    // Replace any remaining usages
    content = content.replace(/\bLOCAL_WORKSPACE_ID\b/g, 'getWorkspaceId(c)'); 
    content = content.replace(/\bLOCAL_OWNER_ID\b/g, 'getUserId(c)'); 
    
    // Calculate prefix for imports
    const parts = filePath.split(path.sep);
    const routesIndex = parts.indexOf('routes');
    const depth = parts.length - routesIndex - 2;
    const prefix = depth === 0 ? './' : '../'.repeat(depth);
    
    content = `import { getUserId, getWorkspaceId } from '${prefix}helpers.js';\n` + content;
    
    fs.writeFileSync(filePath, content);
    console.log('Fixed ' + filePath);
  }
});
