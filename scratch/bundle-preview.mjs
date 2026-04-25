import fs from 'fs';
import path from 'path';

const files = [
    'preview/src/settings.js',
    'preview/src/parser.js',
    'preview/src/renderer.js',
    'preview/src/preview-init.js'
];

let bundle = '// OSU PREVIEW BUNDLE\n(function() {\n console.log("PREVIEW BUNDLE STARTING");\n';

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    // Remove imports
    content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*'.*?';?/g, '');
    content = content.replace(/import\s*.*?\s*from\s*'.*?';?/g, '');
    // Remove exports
    content = content.replace(/^export\s+/gm, '');
    content = content.replace(/^export\s*\{[\s\S]*?\};?/gm, '');
    
    bundle += `\n// --- ${file} ---\n` + content + '\n';
}

bundle += '\n})();';

fs.writeFileSync('preview/preview-bundle.js', bundle);
console.log('Bundle created successfully');
