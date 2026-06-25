cd /home/jlima/Projetos/ecommerce/Backend
cat > Procfile <<'EOF'
release: cd apps/backend && npm run db:migrate:safe
web: cd apps/backend && WORKER_MODE=server ADMIN_DISABLED=false npm run start -- --host 0.0.0.0 --port $PORT
worker: cd apps/backend && WORKER_MODE=worker ADMIN_DISABLED=true npm run start
EOF