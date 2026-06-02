#!/usr/bin/env bash
set -e
mkdir -p dist/node_modules/vite \
         "dist/node_modules/@vitejs/plugin-react" \
         "dist/node_modules/@replit/vite-plugin-runtime-error-modal"

cat > dist/node_modules/vite/package.json << 'EOF'
{"name":"vite","version":"0.0.0","type":"module","exports":{".":"./index.js"}}
EOF
cat > dist/node_modules/vite/index.js << 'EOF'
export const createLogger = () => ({
  info: () => {}, warn: () => {}, warnOnce: () => {},
  error: console.error, clearScreen: () => {}, hasWarned: false
});
export const createServer = async () => { throw new Error("vite not available in production"); };
export const defineConfig = (c) => c;
EOF

cat > "dist/node_modules/@vitejs/plugin-react/package.json" << 'EOF'
{"name":"@vitejs/plugin-react","version":"0.0.0","type":"module","exports":{".":"./index.js"}}
EOF
cat > "dist/node_modules/@vitejs/plugin-react/index.js" << 'EOF'
export default () => ({ name: "stub-react" });
EOF

cat > "dist/node_modules/@replit/vite-plugin-runtime-error-modal/package.json" << 'EOF'
{"name":"@replit/vite-plugin-runtime-error-modal","version":"0.0.0","type":"module","exports":{".":"./index.js"}}
EOF
cat > "dist/node_modules/@replit/vite-plugin-runtime-error-modal/index.js" << 'EOF'
export default () => ({ name: "stub-replit" });
EOF

echo "Production stubs created OK"
