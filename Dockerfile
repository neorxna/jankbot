FROM node:9.11.1-alpine
MAINTAINER amcl080@aucklanduni.ac.nz

WORKDIR /usr/app
COPY package*.json .
RUN  npm install
COPY . .
RUN  npm run build
