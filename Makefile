#

.PHONY: all build run setup bash stop logs clean format help

PKG_NAME=imap2slack

all: help

build: ## Build Container
		docker build -t ${PKG_NAME} .

run: ## Run Container
		docker rm ${PKG_NAME} || true
		docker run -it --name ${PKG_NAME} --volume=`pwd`/data:/data ${PKG_NAME}

setup: ## Get refresh token script
		docker run --rm -it --volume=`pwd`/data:/data ${PKG_NAME} ./google_get_access_token.js

bash: ## Run bash in Container
		docker run --rm -it --volume=`pwd`/data:/data ${PKG_NAME} /bin/bash

stop: ## Stop Container
		docker kill ${PKG_NAME} || true
		docker rm ${PKG_NAME} || true

logs: ## Show Container Logs
		docker logs ${PKG_NAME}

clean: ## Clean Containers
		docker ps -a | grep -v "CONTAINER" | awk '{print $$1}' | xargs docker rm
		docker images -a | grep "^<none>" | awk '{print $$3}' | xargs docker rmi

format: ## Format sources by clang-format
		@for i in *.js; do \
			clang-format-3.8 -i -lines=2:99999 $$i; \
		done;

help: ## This help
		@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
