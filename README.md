# 常用的代码片段

## [npm publish 和 gitlab ci 结合](./npm_deploy_nexus_gitlab.js)

使用办法
在 gilab ci 配置,建议把js脚本放到 内网静态资源，不要放到项目目录，这样在多项目的时候改起来方便
```js
// .gilab-ci.yml

image: node

stages:
    - publish-beta
  
publish-beta:
  stage: publish-beta
  script:
    - curl  npm_deploy_nexus_gitlab.js | node  "$type"
  only:
    - beta
```
