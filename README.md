AI Demo — 前后端分离的最小演示

结构:
- server/  - Express 后端，托管静态前端并暴露 /api/chat
- client/public/ - 简单静态前端

快速启动:
1. 进入 ai-demo/server
2. npm install
3. 复制 .env.example -> .env 并填写 OPENAI_API_KEY
4. npm run dev
5. 打开 http://localhost:3000

说明:
- 后端会从 client/public 提供静态资源，启动服务器即可访问单页应用。
- 为了演示方便，保持项目最小可用；后续可拆为完全独立的前端构建与后端 API。