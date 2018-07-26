import { RTMClient, WebClient } from '@slack/client'
import * as requestlib from 'request'
import http from 'http'
import path from 'path'
import fs from 'fs'

const token = process.env.SLACK_TOKEN
const botUserId = process.env.BOT_USER_ID
const hubEnvironment = process.env.HUB_ENVIRONMENT
const jenkinsUser = process.env.JENKINS_USER
const jenkinsKey = process.env.JENKINS_KEY
const attentionTerms = ['hello', 'yo', 'pls', 'hey', 'please', 'bitte']
const existingEnvironments = ['arrondev', 'dev01', 'dev02', 'test', 'prod']

const PORT = 4420
const DEBUGGING = true
const DEFAULT_ENV = 'arrondev'

const rtm = new RTMClient(token)

class CommandType {}
CommandType.Help = 1
CommandType.Redeploy = 2
CommandType.Status = 3
CommandType.Sorry = 4
CommandType.Who = 5
CommandType.CheckGit = 6
CommandType.CheckSecurity = 7
CommandType.Screenshot = 8

Object.freeze(CommandType)

function issueRedeploy(serviceName, request) {
  requestlib.post({
    url: `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/job/service_deploy/buildWithParameters`,
    form: {SLACK_OWNER: request.event.user, SLACK_CHAN: request.event.channel, SERVICE_NAME: serviceName },
  })
}

function issueScreenshotRequest(url, device, request) {
  requestlib.post({
    url: `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/job/screenshot_image/buildWithParameters`,
    form: {SLACK_OWNER: request.event.user, SLACK_CHAN: request.event.channel, 
           TARGET_URL: encodeURIComponent(url), TARGET_DEVICE: encodeURIComponent(device) },
  })
}

function issueGitCheck(serviceName, request) {
  requestlib.post({
    url: `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/job/git_status/buildWithParameters`,
    form: {SLACK_OWNER: request.event.user, SLACK_CHAN: request.event.channel, SERVICE_NAME: serviceName },
  })
}

function issueSecurityUpdateCheck(serviceName, request) {
  requestlib.post({
    url: `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/job/security_status/buildWithParameters`,
    form: {SLACK_OWNER: request.event.user, SLACK_CHAN: request.event.channel, SERVICE_NAME: serviceName },
  })
}

function parseRequest(event) {

// https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array/18647776
  const re = /[^\s"]+|"([^"]*)"/gi
  var parsed = [];
  do {
      var match = re.exec(event.text);
      if (match != null)
      {
          parsed.push(match[1] ? match[1] : match[0]);
      }
  } while (match != null);

  const [ attentionTerm, mention, cmd, env, ...args ] = parsed

  console.log(`Attention term: ${ attentionTerm }`)
  if (attentionTerms.indexOf(attentionTerm) == -1 || mention !== ('<@' + botUserId + '>')) {
    console.log('Bot user was mentioned in the chat but not summoned.')
    return
  }

  var request = {}
  switch (cmd) {
   case 'help':
     request.cmd = CommandType.Help
     break
   case 'status':
     request.cmd = CommandType.Status
     break
   case 'deploy':
     request.cmd = CommandType.Redeploy
     break
   case 'redeploy':
     request.cmd = CommandType.Redeploy
     break
   case 'who':
     request.cmd = CommandType.Who
     break
   case 'check-git':
     request.cmd = CommandType.CheckGit
     break
   case 'screenshot':
     request.cmd = CommandType.Screenshot
     break
   case 'check-security':
     request.cmd = CommandType.CheckSecurity
     break
   default:
     request.cmd = CommandType.Sorry
     break
  }
  request.args = args
  request.event = event
  request.env = env
  return request
}

function dispatchResponse(request) {

  const helpText = `Usage: hey <@mention> {help|status|who|deploy|screenshot|check-git|check-security} [environment] [args...]`
  const sorryText = `I didn't understand the command :( ${ '\n' }`
  const nogoodText = `Something went wrong :( ${ '\n' }`

  var responsePreamble = `*[${hubEnvironment}]* `
  var response = ""

  response += responsePreamble

  if (existingEnvironments.indexOf(request.env) === -1
       && request.cmd !== CommandType.Help
       && request.cmd !== CommandType.Who) {
    response += nogoodText
    response += `I don't know about the environment '${ request.env }'. I only know about: ${ existingEnvironments.join(', ') }.`
    return response
  }

  if (hubEnvironment !== request.env
      && request.cmd !== CommandType.Who
      && request.cmd !== CommandType.Help) {
    console.log(`Ignoring message intended for environment ${ request.env }.`)
    return null
  }

  try {
    switch (request.cmd) {
      case CommandType.Help:
        if (hubEnvironment === DEFAULT_ENV) {
          response += helpText
        }
        break
      case CommandType.Sorry:
        if (hubEnvironment === DEFAULT_ENV) {
        response += sorryText
        response += helpText
        }
        break
      case CommandType.Status:
        response +=
          `Thanks for asking, <@${ request.event.user }>.
          Right now, everything seems good!`
        break
      case CommandType.Redeploy:
        if (request.args.length !== 1) {
          response += sorryText
          response += `Usage: deploy <environment name> <service name>`
        } else {
          var serviceName = request.args[0]
          response += `Rebuild and redeploy will be issued for service *${ serviceName }* shortly <@${ request.event.user }>.`
          issueRedeploy(serviceName, request)
        }
        break
      case CommandType.Who:
        // all instances should listen to who!
        response += "I am attached!"
        break
      case CommandType.CheckGit:
        if (request.args.length !== 1) {
          response += sorryText
          response += `Usage: check-git <environment name> <service name>`
        } else {
          const serviceName = request.args[0]
          response += `Issuing \`git-fetch && git-status\` for service *${ serviceName }*...`
          issueGitCheck(serviceName, request)
        }
        break
      case CommandType.CheckSecurity:
        if (request.args.length !== 1) {
          response += sorryText
          response += `Usage: check-security <environment name> <service name>`
        } else {
          const serviceName = request.args[0]
          response += `Running \`apt-get upgrade -s | grep -i security\` on container for service *${ serviceName }*...`
          issueSecurityCheck(serviceName, request)
        }
        break
      case CommandType.Screenshot:
        if (request.args.length === 0) {
          response += sorryText
          response += `Usage: screenshot <environment name> <url> [device emulation string]`
        } else {
          const screenshotUrl = request.args[0], deviceString = request.args[1]
          response += `Screenshot for url *${ screenshotUrl }* has been requested.`
          issueScreenshotRequest(screenshotUrl.slice(1, -1), deviceString, request)
        }
        break
      default:
        return null
        break
    }
  } catch(e) {
      response += '\n'
      response += nogoodText
      response += '\n'
      response += JSON.stringify(e)
  }
  return response
}

function respondTo(event) {
  try {
    // don't bother parsing unless bot user was mentioned in the event
    if (event.text.indexOf('<@'+ botUserId + '>') !== -1) {
      const request = parseRequest(event)
      const responseText = request ? dispatchResponse(request) : null

      if (responseText) {
        console.log(`Sending response: ${ responseText }`)
        rtm.send('message', {text: responseText, channel: event.channel, thread_ts: event.ts})
        .then(console.log).catch(console.error)
      }
    }
  } catch (e) {
    console.error(e)
  }
}

const web = new WebClient(token)

if (token && hubEnvironment && botUserId) {

  rtm.start();

  rtm.on('hello', (event) => {
    console.log('connected to slack!');
  });

  rtm.on('message', (event) => {
    if(DEBUGGING) console.log(JSON.stringify(event))
    if (!event.subtype && event.user !== botUserId) {
      respondTo(event)
    }
  });
} else {
  console.error(`Unable to start: missing environment variables!`)
}
const preamble = `*[${hubEnvironment}]* `

var server = http.createServer((req, res) => {
  try {
  const [_, command, jobName, buildNumber, slackOwner, slackChannel, slackThread] = req.url.split('/')

  res.writeHead(200, {'Content-Type': 'text/html'})
  res.write("\r\n")
  res.end()

  if (command === 'jobComplete' && slackOwner && slackChannel) {
      setTimeout( ()=> {

//      const isLog = jobName.indexOf('_deploy') !== -1
      const isImage = jobName.indexOf('_image') !== -1
      const isGitStatus = jobName.indexOf('_status') !== -1
      const isLog = !isImage && !isGitStatus

      const fileUrl = (isLog || isGitStatus) ? `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/job/${ jobName }/${ buildNumber }/consoleText`
             : `http://${ jenkinsUser }:${ jenkinsKey }@automation:8080/userContent/screenshot_${ buildNumber }.png`

      if (isLog || isImage) {
      // upload the logs
        var options = {
          filename: isLog ? `${jobName}_${buildNumber}_log.txt` : `${jobName}_${buildNumber}.png`,
          file: requestlib.get(fileUrl),
          channels: `${ slackChannel }`
        }

        web.files.upload(options).then((fileResp) => {
        const messageText = `${ preamble } Hey <@${ slackOwner }> - ${ jobName } build ${ buildNumber } finished!`

//          rtm.send('message', { channel: slackChannel, text: messageText, thread_ts: fileResp.file.ts })
  //        .then(console.log).catch(console.error)

	  if (isLog) {
            requestlib.get(fileUrl, (err, resp, body) => {
              const jobSucceeded = body.indexOf('Finished: SUCCESS') !== -1
              web.reactions.add({name: jobSucceeded ? 'thumbsup' : 'thumbsdown', channel: slackChannel, file: fileResp.file.id })
              .then(console.log).catch(console.error)
           })
          }
      })
      } else {
       // no need to upload the log
       const messageText = `${ preamble } Hey <@${ slackOwner }> - got a response: ${ "\n" }`
       requestlib.get(fileUrl, (error, response, body) => {
         const grepLines = body.match(/^.*branch.*$/mg)
         rtm.send('message', { channel: slackChannel, text: messageText + `\`\`\`${grepLines.join("\n")}\`\`\`` })
         .then(console.log).catch(console.error)
       })
      }

   }, 2000) //setTimeout
  } //if

  if (command === 'ciComplete') {
   }

  } catch (e) {
    console.error(e)
  }
}).listen(PORT)

console.log(`Server is monitoring callbacks from Jenkins on port ${ PORT }`)

