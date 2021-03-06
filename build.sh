#!/usr/bin/env bash
#stop on error
#------------
set -e

# full list of supported - outputted parts
app_full_list=( reverse-proxy fluentd web-server rest-api scheduler crossbar wamp-api mongodb )

#set list of services from command line or default full list
if [[ "$#" -eq 0 ]]; then
  app_list=( "${app_full_list[@]}" chameleon )
else
  app_list=( "$@" )
fi

#remove chameleon if exists - do it at the end
num_of_apps=${#app_list[@]}
app_list=(${app_list[@]//chameleon/})
num_of_apps_minus_chameleon=${#app_list[@]}
do_dist=$((num_of_apps - num_of_apps_minus_chameleon))

# Build and archive all required docker images
for app in "${app_list[@]}"
do
    echo =================================================
    echo Building and archiving  \"$app\"
    echo =================================================
    mkdir -p ./docker-image-archives
    cd ./$app
    ./build.sh
    ./archive.sh
    cd ..
done

# Make distribution folder if required
if [[ "$do_dist" -gt 0 ]]
then
    echo =================================================
    echo Building distribution folder for \"Chameleon\"
    echo =================================================

    rm -rf ./dist/
    mkdir -p ./dist/docker-images

    #create production .env file
    node ./misc/src/makeProductionEnvFile.js

    #create server docker images load script
    touch ./dist/docker-images/load-docker-images.sh
    chmod +x  ./dist/docker-images/load-docker-images.sh
    echo "#!/usr/bin/env bash" > ./dist/docker-images/load-docker-images.sh
    #prune all current docker images etc...
    echo docker system prune -a -f --volumes >> ./dist/docker-images/load-docker-images.sh

    for app_image in "${app_full_list[@]}"
    do
        if test -f ${app_image}/VERSION ; then
            version=$(<./${app_image}/VERSION)
        else
            version=$(cat ./${app_image}/package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]')
        fi
        echo Exporting image archive ${app_image}-${version}.tar
        #copy docker image
        cp ./docker-image-archives/${app_image}-${version}.tar ./dist/docker-images/${app_image}-${version}.tar
        echo docker load -i ./${app_image}-${version}.tar >> ./dist/docker-images/load-docker-images.sh
    done
    # copy server files
    cp ./docker-compose.yml ./dist/docker-compose.yml
    cp ./traefik-prod.toml ./dist/traefik.toml
    cp -r ./www ./dist/www
    mkdir -p ./dist/pusher-releases/linux
    mkdir -p ./dist/pusher-releases/mac
    mkdir -p ./dist/pusher-releases/win
    cp ./pusher-releases/icon.ico ./dist/pusher-releases/icon.ico
fi
