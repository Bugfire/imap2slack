PKG_NAME=imap2slack

build:
		docker build -t ${PKG_NAME} .

run:
		docker rm ${PKG_NAME} || true
		docker run -it --name ${PKG_NAME} --volume=`pwd`/data:/data ${PKG_NAME}

stop:
		docker kill ${PKG_NAME} || true
		docker rm ${PKG_NAME} || true

logs:
		docker logs ${PKG_NAME}

clean:
		docker ps -a | grep -v "CONTAINER" | awk '{print $$1}' | xargs docker rm
		docker images -a | grep "^<none>" | awk '{print $$3}' | xargs docker rmi
