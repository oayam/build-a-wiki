.PHONY: check frontend backend migrate
frontend:
	cd frontend && npm run build
backend:
	cd backend && cargo build --locked
migrate:
	cd backend && cargo run --locked --bin migrate
check:
	bash scripts/check.sh
