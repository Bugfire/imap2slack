#

.PHONY: $(shell egrep -o ^[a-zA-Z_-]+: $(MAKEFILE_LIST) | sed 's/://')

default: help

build: ## Build docker
	docker-compose build

push: ## Push docker
	docker-compose push

run: ## Run docker
	docker-compose down || true
	docker-compose up

stop: ## Stop docker
	docker-compose down

logs: ## Show docker logs
	docker-compose logs

lint: ## Run eslint
	npm run lint

clean: ## Clean docker container, images
	docker ps -a | grep -v "CONTAINER" | awk '{print $$1}' | xargs docker rm
	docker images -a | grep "^<none>" | awk '{print $$3}' | xargs docker rmi

help: ## This help
	@grep -Eh '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
