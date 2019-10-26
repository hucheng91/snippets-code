// @ts-nocheck

/**
 * @author hucheng
 * @date 2019-10-21
 * @description npm pubish 脚本
 * 
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { exec} = require('child_process');
const https = require('https')
const utils = utilsFn();
const logger = loggerFn();
const gitlabRunInfo = utils.getInfoFromGitlabCi();
const publishConfig  =  { "registry": "http://xxxnexus.net/repository/scope/"};

// lunix:copy vi ~/.npmrc
const  npmrcText = `registry=http://xxxnexus.net/repository/scope/
//xxxnexus.net/repository/scope/:_authToken=NpmToken.xxx
`
const GITLAB_TOKEN = "xxx";
const GITLAB_BASE_URL = "https://xxxnexus.net/api/v4"
const GIT_USER = ""
const GIT_EMAIL = ""


const argv = utils.formatArgs();
const versionInfo = argv.versionInfo
let versionIndex = 0;
const startTime = new Date().getTime()

init()

async function init (){
    if(gitlabRunInfo.commit.commit_messge.includes('_update_by_ferobot_hc')){
        logger.info('这个是机器人在更新 版本信息，不执行发布，退出洛')
        execa('gitlab-runner',[`stop`])
        return
    }
    await publish(versionInfo)
}
async function  publish(versionInfo){

    console.log('/**************************************** start ************************************/')

    const branch = gitlabRunInfo.commit.ref;
    let argsArray = ['publish']
    
    await configNpmrcRaw();

    const packageJSON = await checkPackageJsonPublsihConfig()                   // 检查 publishConfig 字段
    logger.info(` *********** current package.json version ${packageJSON.version} *******`)
    
    await configGit();
    let new_version = await publishToNexus(); 

    let object = Object.assign(gitlabRunInfo,{branch:branch,version:new_version})
    await updateGitRaw(object)

    const time = new Date().getTime() - startTime


    console.log(`/**************************************** ending，耗时 ${time / 1000}s  ************************************/`)


    async function configNpmrcRaw(){
        fs.writeFileSync(path.resolve(os.homedir(),'.npmrc'),npmrcText) // 将发布人信息写入本地
    }
    async function configGit(){
        await execa('git',['config','user.name',GIT_USER])
        await execa('git',['config','user.email',GITLAB_USER_EMAIL])
        try {
            await execa('git',['checkout', 'package.json'] )
            await execa('git',['checkout', 'package-lock.json'] )
        } catch (error) {
            
        }
        
    }
    
    async function publishToNexus(){
        let new_version  = await execa('npm',['version',utils.getNpmVersion(branch,versionInfo)])
        new_version = new_version.split('\n')[0].split('v')[1]
        console.log(`new_version`,new_version)
        argsArray = argsArray.concat(['--tag',utils.getTagByBranch(branch)])
        logger.info(` *********** start npm ${argsArray.join(" ")} *******`)
        
        try {
            await execa('npm',argsArray)
            logger.info(`npm publish   ${packageJSON.name} ${new_version} success`)
        } catch (error) {
            if(versionIndex >5){
                process.exit(0)
                throw new Error(err)
            }
            versionIndex++
            logger.error(error)
            logger.error(`npm publish error,可能是版本冲突了，再发一次`)
            publish(branch,versionInfo,({data,mesasge}) => {logger.info(mesasge)})
        }
        
        return new_version
    }


       

    
    
}
async function checkPackageJsonPublsihConfig(){
    let rawdata = fs.readFileSync('package.json').toString('utf8');
    let packageJSON = JSON.parse(rawdata);
    if(!packageJSON.publishConfig){
        console.warn(`package.json do not have ${publishConfig} config, try config it `)
        packageJSON.publishConfig = publishConfig
        fs.writeFileSync(path.resolve(__dirname,'package.json'),JSON.stringify(packageJSON,null,2))
    }
    return packageJSON
    
}


async function updateGitRaw (option = {}){
    const {project,branch,version,user} = option;


    await updatePackagejson()
    await updateTag()
    await mergeVersiontoBranch()
   
    

    async function updatePackagejson(){
        await updatePackagejsonVersion(project.id,branch,version)
        logger.info(`update ${branch} branch package.json version field success`)
    }
    //
    async function updateTag(){
        let tagOption = {
            tag_name: `${version}`,
            ref: branch,
            message: `releae ${version} tag`
        }
        await execa(`curl --request POST --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" "${GITLAB_BASE_URL}/projects/${project.id}/repository/tags?tag_name=${version}&ref=${branch}&message=res${version}"`)
        logger.info(`、create tag ${version}  on ${branch} branch success`)
    }
    
    async function mergeVersiontoBranch(){
        const allBranch = await  execa(`curl --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" ${GITLAB_BASE_URL}/projects/${project.id}/repository/branches`)
        let branchNameArray= Array.from(allBranch).map(ele => ele.name);
        if(!branchNameArray.includes('beta') || !branchNameArray.includes('dev')){
        let message = `组件 ${project.name}  publish 完成 版本号 ${version}，可以通过 npm info  ${project.name} 查看信息,  但是开发的组件包不符合开发规范，至少需要3个branchs，master(发布稳定版本)，beta(发布beta版本)，dev(开发版本)`
        logger.warn(message)
        utils.sendWxByEmail(user.email,message)
        }else{
            message = `组件 ${project.name}  publish 完成 版本号 ${version}，可以通过 npm info  ${project.name} 查看信息, `
            logger.info(message)
            utils.sendWxByEmail(user.email,message)

        }
        if(branch == 'master'){
            if(branchNameArray.includes('beta')){
                await updatePackagejsonVersion(project.id,'beta',version)
                logger.info(`update  ${branch} branch  package.json version to ${version} success`)
            }
            if(branchNameArray.includes('dev')){
                await updatePackagejsonVersion(project.id,'dev',version)
                logger.info(`update  ${branch} branch  package.json version to ${version} success`)
            }
        }
        if(branch == 'beta'){
            if(branchNameArray.includes('dev')){
                await updatePackagejsonVersion(project.id,'dev',version)
                logger.info(`update  ${branch} branch  package.json version  to ${version} success`)
            }
        }
    }

    async function updatePackagejsonVersion(projectId,branch,version){
        let  package  = await  execa(`curl --request GET --header 'PRIVATE-TOKEN: ${GITLAB_TOKEN}' '${GITLAB_BASE_URL}/projects/${projectId}/repository/files/package.json/raw?ref=${branch}'`)

        package = JSON.parse(package)
        package.version = version;
        let commit_message = `${version}_${branch}_update_by_ferobot_hc`

        let options = {
            body: {
                "branch": `${branch}`,
                "commit_message": `${commit_message}`,
                content: JSON.stringify(package,null,2)
            },
            method:"PUT",
            headers: {'PRIVATE-TOKEN': `${GITLAB_TOKEN}`}
        }
        const url = `${GITLAB_BASE_URL}/projects/${projectId}/repository/files/package.json`
        return  await utils.request(url,options)
    }
    
    
}


function utilsFn() {
   
   return {
        formatArgs: function(){
            let  argv = process.argv
            argv = argv.splice(2,argv.length);

            if(!argv || argv.length == 0){return false}

            return argv.reduce((_all,currentValue) => {
                _all = Object.assign(_all,operateFn(currentValue))
                return _all
            },{})

            function operateFn(ele){
                let result = {};
                try {
                    let arry =  ele.split("--")[1].split('=')
                    result[arry[0]] = arry[1]  
                } catch (error) {
                    throw new Error('error: your args is error,you need like  node npm_publish.js --beta=xxx --fn=xxx')
                }
                return result
                
            }
        },
        getNpmVersion: function(branch,version = 'patch'){

                let hash = {
                    'beta': 'prerelease',
                    'master':`${version}`
                }
                if(!hash[branch]){return 'prerelease'}
                return  hash[branch]
        },
        getTagByBranch: function(branch){
            let hash = {
                'beta': 'beta',
                'master':'latest'
            }
            if(!hash[branch]){return hash['beta']}

            return hash[branch]
        },
        pullByBranch: function(branch){
           
        },
        getInfoFromGitlabCi: function(){
            const env = process.env;
            return {
                server: {
                    name: env.CI_SERVER_NAME,
                    revision: env.CI_SERVER_REVISION,
                    version: env.CI_SERVER_VERSION,
                },
                commit: {
                    commit_messge: env.CI_COMMIT_MESSAGE,
                    ref: env.CI_COMMIT_REF_NAME,
                    refSlug: env.CI_COMMIT_REF_SLUG,
                    sha: env.CI_COMMIT_SHA,
                    tag: env.CI_COMMIT_TAG,
                },
                job: {
                    id: parseInt(env.CI_JOB_ID, 10),
                    manual: parseBool(env.CI_JOB_MANUAL),
                    name: env.CI_JOB_NAME,
                    stage: env.CI_JOB_STAGE,
                    token: env.CI_JOB_TOKEN,
                },
                pipeline: {
                    id: parseInt(env.CI_PIPELINE_ID, 10),
                    triggered: parseBool(env.CI_PIPELINE_TRIGGERED),
                },
                project: {
                    dir: env.CI_PROJECT_DIR,
                    id: parseInt(env.CI_PROJECT_ID, 10),
                    name: env.CI_PROJECT_NAME,
                    namespace: env.CI_PROJECT_NAMESPACE,
                    path: env.CI_PROJECT_PATH,
                    url: env.CI_PROJECT_URL,
                    repo: env.CI_REPOSITORY_URL,
                },
                debug: parseBool(env.CI_DEBUG_TRACE),
                registry: env.CI_REGISTRY === undefined ? undefined : {
                    registry: env.CI_REGISTRY,
                    image: env.CI_REGISTRY_IMAGE,
                },
                environment: env.CI_ENVIRONMENT_NAME === undefined ? undefined : {
                    name: env.CI_ENVIRONMENT_NAME,
                    slug: env.CI_ENVIRONMENT_SLUG ,
                },
                runner: {
                    id: parseInt(env.CI_RUNNER_ID, 10),
                    description: env.CI_RUNNER_DESCRIPTION,
                    tags: (env.CI_RUNNER_TAGS || '').split(',').map(x => x.trim()).filter(x => x.length > 0),
                },
                user: {
                    id: parseInt(env.GITLAB_USER_ID, 10),
                    email: env.GITLAB_USER_EMAIL,
                },
            }
            function parseBool(raw) {
                if (raw === undefined) {
                  return false;
                }
                raw = raw.toLowerCase();
                return raw === 'true' || raw === 'yes';
              }
                  
        },
        sendWxByEmail(email, content) {
            // 这里调用通知信息
            exec(curlText)
        },
        request(path,option){
            const url = new URL(path)
            return new Promise((resolve,reject) => {
                const req = https.request({
                    hostname: url.hostname,
                    port: 443,
                    method: option.method,
                    headers: Object.assign({'Content-Type': 'application/json'},option.headers || {}),
                    path: url.pathname,
                },(res) => {
                    res.on('data', (data) => {
                        resolve(data.toString('utf8'))
                    })
                })
                if(option.body){
                    req.write(JSON.stringify(option.body))
                }
                req.on('error', (e) => {
                    reject(e);
                  });
                req.end();
            })
        }
   } 
}

function loggerFn(){
    let baseMesasge = 'npm publish runer: '
    return {
        error: function(mesasge){console.error(`${baseMesasge}${mesasge}`)},
        warn: function(mesasge){console.warn(`${baseMesasge}${mesasge}`)},
        info: function(mesasge){console.info(`${baseMesasge}${mesasge}`)}
    }
}
async function execa(a,arry = []){
    return new Promise((resolve,reject) => {
        exec(`${a} ${arry.join(' ')}`, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                reject(err);
            }
            resolve(stdout)
        })
    })
}