'use strict';
const pusherClient = require('../pusherClient');
const db = require('../dbData/mongoDb-pusher');
const wamp = require('../wamp');
const email = require('../email');
const logger = require('../logger');
const moment = require('moment');

module.exports = {
    // - - - tasks - - -
    'getTasksForUser': getTasksForUser,
    'postponeTask': postponeTask,
    'completeTask': completeTask,
    'forwardTask': forwardTask,
    'createSubTask': createSubTask,
    'createBigArchiveTask': createBigArchiveTask,
    'createFreelancerTask': createFreelancerTask,
    'setArchiveCheckItemStatus': setArchiveCheckItemStatus,

    // - - - messages + create - - -
    'getMessagesForUser': getMessagesForUser,
    'sendMessage': sendMessage,
    'postponeMessage': postponeMessage,
    'confirmMessage': confirmMessage,
    'getUsersAndGroupsForCreate': getUsersAndGroupsForCreate,
    'createUserGroupForCreate': createUserGroupForCreate,
    'updateUserGroupForCreate': updateUserGroupForCreate,
    'removeUserGroupForCreate': removeUserGroupForCreate,

    // - - - work - clock - - -
    'getWorkClock': getWorkClock,
    'setWorkClock': setWorkClock,
    'setWorkClockRequest': setWorkClockRequest,
    'cancelWorkClockRequest': cancelWorkClockRequest,

    // - - - work - log - - -
    'getWorklogsForUser': getWorklogsForUser,
    'confirmWorkLog': confirmWorkLog,

    // - - - get other data - - -
    'getUsersByRole': getUsersByRole,
    'getProjectTeamForUser': getProjectTeamForUser,
    'getFreelancers': getFreelancers,
    'getAllPusherUsers': getAllPusherUsers,

    // - - - debug - - -
    'getPusherClients': getPusherClients
};
// ---------------------------------------------------------------------------------------------------------------------
//    T A S K S
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get tasks for user
// *********************************************************************************************************************
async function getTasksForUser(args, kwargs) {
    try {
        logger.debug('getTasksForUser ' + kwargs.user);
        const tasks = await db.getTasksForUser(kwargs.user);
        return {tasks: tasks};
    } catch(error) {
        logger.warn("getTasksForUser error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Get users by role
// *********************************************************************************************************************
async function getUsersByRole(args, kwargs) {
    try {
        logger.debug('getUsersByRole');
        if(kwargs.role && kwargs.role.indexOf('booking:') !== 0) kwargs.role = 'booking:' + kwargs.role;
        return await db.getUsersByRole(kwargs.role);
    } catch(error) {
        logger.warn("getUsersByRole error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Postpone task
// *********************************************************************************************************************
async function postponeTask(args, kwargs, details) {
    try {
        logger.debug('postponeTask ' + kwargs.id);
        const task = await db.postponeTask(kwargs.id, kwargs.days);
        const ssoId = await db.getSsoIdsForUsers(task.target);
        if(ssoId && pusherClient.numOfClientsForUser(ssoId) > 1) wamp.publish(`${ssoId}.task`, [kwargs.id], {
            dueTo: moment(task.deadline).add(task.postpone,'days').startOf('day').format('YYYY-MM-DD')
        }, {exclude : [details.caller]});
    } catch(error) {
        logger.warn("postponeTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Complete task
// *********************************************************************************************************************
async function completeTask(args, kwargs, details) {
    try {
        logger.debug('completeTask ' + kwargs.id);
        const tasks = await db.completeTask(kwargs.id, kwargs.data);
        //tasks - index 0 - original normalized task to remove on other clients of the user, index > 0 - updated tasks affected by original one. (PUBLISH, ARCHIVE, ...)
        for(const [i, task] of tasks.entries()) {
            if(task.target) {
                if(i === 0) { //remove on other clients
                    if(pusherClient.numOfClientsForUser(task.target) > 1) wamp.publish(`${task.target}.task`, [task.id], {}, {exclude: [details.caller]});
                } else wamp.publish(`${task.target}.task`, [task.id], task); //send affected tasks
            }
        }
        const data = await db.followTaskCompleted(kwargs.id);
        if(data.tasks && data.tasks.length > 0) {
            for (const task of data.tasks) {
                if (task.target) wamp.publish(`${task.target}.task`, [], task);
            }
            wamp.publish('checkPusher', [true]);
        }
        for(const message of data.messages) {
            if(message.target) wamp.publish(`${message.target}.message`, [], message);
        }
        for(const project of data.updateProjects) {
            wamp.publish('updateProject', [], project);
        }
    } catch(error) {
        logger.warn("completeTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Forward task
// *********************************************************************************************************************
async function forwardTask(args, kwargs, details) {
    try {
        logger.debug(`forwardTask ${kwargs.id} from user ${kwargs.user} to user ${kwargs.target.id} [${kwargs.target.name}]`);
        const task = await db.forwardTask(kwargs.id, kwargs.target.id);
        wamp.publish(`${task.target}.task`, [], task); //send task to new target
        wamp.publish(`${kwargs.user}.task`, [task.id], {}, {exclude: [details.caller]}); //remove on other original clients
    } catch(error) {
        logger.warn("forwardTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Create sub-task
// *********************************************************************************************************************
async function createSubTask(args, kwargs, details) {
    try {
        logger.debug(`createSubTask of ${kwargs.task}`);
        const task = await db.createOrModifySubTask(kwargs);
        if(task) {
            if(kwargs.kind === 'done' && !kwargs.status) {wamp.publish(`${task.target}.task`, [task.id], {});} //remove
            else if(kwargs.kind === 'archive') {wamp.publish(`${task.target}.task`, [], task);} //add new
            if(pusherClient.numOfClientsForUser(kwargs.origin)) {
                const originalTask = await db.getTaskById(kwargs.task);
                if(originalTask) wamp.publish(`${originalTask.target}.task`, [originalTask.id], originalTask, {exclude: [details.caller]});
            }
        }
    } catch(error) {
        logger.warn("createSubTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Create big archive task
// *********************************************************************************************************************
async function createBigArchiveTask(args, kwargs) {
    try {
        logger.debug(`createBigArchiveTask of ${kwargs.task} for work ${kwargs.work}`);
        const data = await db.createBigArchiveTask(kwargs.task, kwargs.work);
        if(data.bigTask && data.bigTask.target && pusherClient.numOfClientsForUser(data.bigTask.target)) wamp.publish(`${data.bigTask.target}.task`, [], data.bigTask); //add
        if(data.parentTask && data.parentTask.target && pusherClient.numOfClientsForUser(data.parentTask.target)) wamp.publish(`${data.parentTask.target}.task`, [data.parentTask.id], data.parentTask); //update
    } catch(error) {
        logger.warn("createBigArchiveTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Create freelancer task
// *********************************************************************************************************************
async function createFreelancerTask(args, kwargs) {
    try {
        logger.debug(`createFreelancerTask, freelancer ${kwargs.freelancer}, project ${kwargs.project}`);
        const task = await db.createFreelancerTask(kwargs);
        if(task && task.target && pusherClient.numOfClientsForUser(task.target)) wamp.publish(`${task.target}.task`, [], task);
    } catch(error) {
        logger.warn("createFreelancerTask error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Set archive check list item status
// *********************************************************************************************************************
async function setArchiveCheckItemStatus(args, kwargs, details) {
    try {
        logger.debug(`setArchiveCheckItemStatus, task ${kwargs.task}, field ${kwargs.name}, status ${kwargs.status}`);
        const task = await db.setArchiveCheckItemStatus(kwargs);
        if(task && task.target && pusherClient.numOfClientsForUser(task.target)) wamp.publish(`${task.target}.task`, [task.id], task, {exclude: [details.caller]});
    } catch(error) {
        logger.warn("setArchiveCheckItemStatus error: " + error);
        throw error;
    }
}
// ---------------------------------------------------------------------------------------------------------------------
//    M E S S A G E S  +  C R E A T E
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get messages for user
// *********************************************************************************************************************
async function getMessagesForUser(args, kwargs) {
    try {
        logger.debug('getMessagesForUser ' + kwargs.user);
        const messages = await db.getMessagesForUser(kwargs.user);
        return {messages: messages};
    } catch(error) {
        logger.warn("getMessagesForUser error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Send Message
// *********************************************************************************************************************
async function sendMessage(args, kwargs) {
    try {
        logger.debug(`sendMessage by ${kwargs.origin}`);
        const origin = await db.getUserBySsoId(kwargs.origin);
        const deadline = kwargs.type === 'NOW' ? moment() : kwargs.type === 'TODAY' ? moment().startOf('day') : kwargs.type === 'NORMAL' ? moment().add(kwargs.days, 'day').startOf('day') : moment();
        const messageData = {
            type: kwargs.type,
            confirm: kwargs.confirm,
            origin: origin ? origin.id : null,
            label: `Message sent by ${origin ? origin.name : 'Unknown User'}`,
            message: kwargs.message,
            target: kwargs.targets,
            deadline: deadline
        };
        const messages = await db.addMessage(messageData);
        for(const message of messages) {
            if(message.target) wamp.publish(`${message.target}.message`, [], message);
        }
        if(kwargs.withEmail) {
            logger.debug(`sendMessage by email`);
            await email.sendPusherMessage(messageData);
        }
    } catch(error) {
        logger.warn("sendMessage error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Postpone Message
// *********************************************************************************************************************
async function postponeMessage(args, kwargs, details) {
    try {
        logger.debug('postponeMessage ' + kwargs.id);
        const message = await db.postponeMessage(kwargs.id, kwargs.days, kwargs.user);
        if(pusherClient.numOfClientsForUser(kwargs.user) > 1) {
            wamp.publish(`${kwargs.user}.message`, [kwargs.id], {
                dueTo: moment(message.deadline).add(message.postpone, 'days').startOf('day').format('YYYY-MM-DD')
            }, {exclude : [details.caller]});
        }
    } catch(error) {
        logger.warn("postponeMessage error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Confirm Message
// *********************************************************************************************************************
async function confirmMessage(args, kwargs, details) {
    try {
        logger.debug(`confirmMessage ${kwargs.id} by ${kwargs.user}, answer: ${kwargs.answer}`);
        const user = await db.getUserBySsoId(kwargs.user);
        const data = await db.confirmMessage(kwargs.id, kwargs.answer, user);
        if(data.update) wamp.publish(`${data.update.target}.message`, [data.update.id], {details: data.update.details}); // if details undefined => remove
        if(pusherClient.numOfClientsForUser(kwargs.user) > 1) wamp.publish(`${kwargs.user}.message`, [kwargs.id], {}, {exclude : [details.caller]}); //remove on other clients of user
        let messages;
        if(kwargs.answer === 'explain') { //Add new message - need explain as answer of message with confirmation
            messages = await db.addMessage({
                type: 'INFO',
                target: data.message.origin,
                deadline: moment().startOf('day'),
                label: `Explain message required.`,
                message: `${user.name} require explanation of your message: "${data.message.message}" sent: ${moment(data.message.timestamp).format('DD/MM HH:mm')}.`
            });
        } else if(kwargs.answer === 'find-me') { //Add new message - work request will be fulfilled by kwargs.user
            //TODO update details by Find me user request ????
            messages = await db.addMessage({
                type: 'NOW',
                target: data.message.origin,
                deadline: moment(),
                label: `Await Work - Find Me.`,
                message: `${user.name} has a work for you, find her/him.`
            });
        }
        if(messages && messages.length) wamp.publish(`${messages[0].target}.message`, [], messages[0]);
    } catch(error) {
        logger.warn("confirmMessage error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Get Users And Groups For Create
// *********************************************************************************************************************
async function getUsersAndGroupsForCreate(args, kwargs) {
    try {
        logger.debug('getUsersAndGroupsForCreate ' + kwargs.user);
        return await db.getUsersAndGroupsForCreate(kwargs.user);
    } catch(error) {
        logger.warn("getUsersAndGroupsForCreate error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Create User Group For Create
// *********************************************************************************************************************
async function createUserGroupForCreate(args, kwargs) {
    try {
        logger.debug('createUserGroupForCreate ' + kwargs.user);
        await db.createUserGroupForCreate(kwargs.id, kwargs.label, kwargs.members, kwargs.owner);
    } catch(error) {
        logger.warn("createUserGroupForCreate error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Update User Group For Create
// *********************************************************************************************************************
async function updateUserGroupForCreate(args, kwargs) {
    try {
        logger.debug('updateUserGroupForCreate ' + kwargs.user);
        await db.updateUserGroupForCreate(kwargs.id, kwargs.members);
    } catch(error) {
        logger.warn("updateUserGroupForCreate error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Remove User Group For Create
// *********************************************************************************************************************
async function removeUserGroupForCreate(args, kwargs) {
    try {
        logger.debug('removeUserGroupForCreate ' + kwargs.user);
        await db.removeUserGroupForCreate(kwargs.id);
    } catch(error) {
        logger.warn("removeUserGroupForCreate error: " + error);
        throw error;
    }
}
// ---------------------------------------------------------------------------------------------------------------------
//    W O R K  -  C L O C K
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get work clock for ssoId user
// *********************************************************************************************************************
async function getWorkClock(args, kwargs) {
    try {
        logger.debug('getWorkClock for user: ' + kwargs.user);
        const clock = await db.getWorkClock(kwargs.user, true);
        return {workClock: clock};
    } catch(error) {
        logger.warn("getWorkClock error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Set work clock for ssoId user
// *********************************************************************************************************************
async function setWorkClock(args, kwargs, details) {
    try {
        logger.debug('setWorkClock for user: ' + kwargs.user + ' - ' + kwargs.state);
        const data = await db.setWorkClock(kwargs.user, kwargs.state);
        //inform other clients (update all users list)
        wamp.publish('all.workclock', [], {userId: data.user._id, user: data.user.ssoId, state: kwargs.state}, {exclude : [details.caller]});
        //if somebody requested to be notified - do it
        for(const user of data.toNotify) wamp.publish(user.ssoId + '.workclockrequest', [], {subject: data.user.ssoId, requested: false}, {exclude : [details.caller]});
        let stateString = '';
        switch (kwargs.state) {
            case 'OUT':
                stateString = 'Out of office';
                break;
            case 'BUSY':
                stateString = 'Working';
                break;
            case 'READY':
                stateString = 'Await work';
                break;
            case 'PAUSE':
                stateString = 'Work break';
                break;
            case 'PAUSE_READY':
                stateString = 'Await work - break';
                break;
            default: stateString = 'Unknown'
        }
        if(data.toNotify.length > 0) {
            const message = {
                type: 'NOW',
                label: 'Work-Clock status changed',
                message: `${data.user.name} has changed his/her work-clock status.`,
                target: data.toNotify.map(u => u._id.toString()),
                deadline: moment(),
                details: `Current status: ${stateString}`
            };
            const newMessages = await db.addMessage(message);
            newMessages.forEach(message => {
                if(message.target) wamp.publish(message.target + '.message', [], message);
            });
        }
        // if work requested (raised hand)
        if(kwargs.ready === true) { // if state is ready or leave ready - notify manager, supervisor,...
            const leads = await db.getTodayUserLeads(kwargs.user);
            const data = await db.createWorkRequest(kwargs.user, leads); // {requestId: id, stageLeads: [id]}
            const message = {
                type: 'WORK_REQUEST',
                label: 'Await Work',
                message: `${data.user.name} is awaiting work.`,
                origin: data.user.id,
                target: data.stageLeads,
                deadline: moment()
            };
            const newMessages = await db.addMessage(message);
            if(newMessages && newMessages.length > 0) {
                newMessages.forEach(message => {
                    if (message.target) {
                        wamp.publish(message.target + '.message', [], message);
                        //logger.debug(`Sent message "${message.label} - ${message.message}" to: ${message.target}`);
                    }
                });
                //email.sendPusherMessage(message);
                return db.addWorkRequestMessageAndStage(data.requestId, newMessages[0].id);
            }
        } else if(kwargs.ready === false) { //close request - set request closed, set details of message(s) to current status and update pusher if some active (not confirmed/answered yet)
            const closedRequests = await db.closeWorkRequest(kwargs.user);
            let messages = closedRequests.reduce((messages, request) => messages.concat(request.messages), []);
            messages = await db.updateMessageDetails(messages, `${new Date()}, ${stateString}`);
            messages.forEach(message => {
                if (message.id && message.target) {
                    wamp.publish(message.target + '.message', [message.id], message);
                    //logger.debug(`Sent update message "${JSON.stringify(message)}" to: ${message.target}`);
                }
            });
        }
    } catch(error) {
        logger.warn("setWorkClock error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Set Work Clock request
// *********************************************************************************************************************
async function setWorkClockRequest(args, kwargs, details) {
    try {
        logger.debug(`setWorkClockRequest by ${kwargs.user}, subject: ${kwargs.subject}`);
        const modified = await  db.setWorkClockRequest(kwargs.user, kwargs.subject);
        if(modified && pusherClient.numOfClientsForUser(kwargs.user) > 1) {
            wamp.publish(`${kwargs.user}.workclockrequest`, [], {subject: kwargs.subject, requested: true}, {exclude : [details.caller]});
        }
    } catch(error) {
        logger.warn("setWorkClockRequest error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Cancel Work Clock request
// *********************************************************************************************************************
async function cancelWorkClockRequest(args, kwargs, details) {
    try {
        logger.debug(`cancelWorkClockRequest by ${kwargs.user}, subject: ${kwargs.subject}`);
        const modified = await  db.cancelWorkClockRequest(kwargs.user, kwargs.subject);
        if(modified && pusherClient.numOfClientsForUser(kwargs.user) > 1) {
            wamp.publish(`${kwargs.user}.workclockrequest`, [], {subject: kwargs.subject, requested: false}, {exclude : [details.caller]});
        }
    } catch(error) {
        logger.warn("cancelWorkClockRequest error: " + error);
        throw error;
    }
}
// ---------------------------------------------------------------------------------------------------------------------
//    W O R K  -  L O G
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get worklogs for user
// *********************************************************************************************************************
async function getWorklogsForUser(args, kwargs) {
    try {
        logger.debug('getWorklogsForUser ' + kwargs.user + ' ' + kwargs.full);
        const worklogs = await db.getWorklogsForUser(kwargs.user, kwargs.full);
        return {projects: worklogs};
    } catch(error) {
        logger.warn("getWorklogsForUser error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Confirm Work Log
// *********************************************************************************************************************
async function confirmWorkLog(args, kwargs, details) {
    try {
        logger.debug(`confirmWorkLog ${kwargs.id} by ${args[0]}, kind: ${kwargs.kind}, value: ${kwargs.value}`);
        const data = await db.confirmWorkLog(kwargs.id, kwargs.kind, kwargs.value);
        // REDUCE DATA BY ACTIVE USERS + ADD DEBUG USER, IF STILL LENGTH > 0, SEND FORCE UPDATE TO THOSE USERS
        const updatedUsers = [];
        const pusherClients = pusherClient.getClients();
        if(data.length > 0) {
            logger.debug(`force users: ${data} to work-log update`);
            Object.keys(pusherClients).forEach(client => {
                if((data.indexOf(pusherClients[client].user) >= 0 || pusherClients[client].debug) && updatedUsers.indexOf(pusherClients[client].user) < 0) {
                    updatedUsers.push(pusherClients[client].user);
                }
            });
            if(updatedUsers.length > 0) {
                updatedUsers.forEach(user => {
                    wamp.publish(`${user}.worklogupdate`);
                });
            }
        }
        if(pusherClient.numOfClientsForUser(args[0]) > 1 && updatedUsers.indexOf(args[0]) < 0) { // update others clients of the same user
            wamp.publish(`${args[0]}.worklogupdate`, [], {}, {exclude: [details.caller]});
        }
    } catch(error) {
        logger.warn("confirmWorkLog error: " + error);
        throw error;
    }
}
// ---------------------------------------------------------------------------------------------------------------------
//    G E T  O T H E R  D A T A
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get all pusher users (list, contacts, workclock, requests by user)
// *********************************************************************************************************************
async function getAllPusherUsers(args, kwargs) {
    try {
        logger.debug('getAllPusherUsers for user ' + kwargs.user);
        const users = await db.getAllUsers(kwargs.user);
        return {users: users};
    } catch(error) {
        logger.warn("getAllPusherUsers error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Get projects team for user
// *********************************************************************************************************************
async function getProjectTeamForUser(args, kwargs) {
    try {
        logger.debug('getProjectTeamForUser ' + kwargs.user);
        const booking = await db.getProjectTeamForUser(kwargs.user);
        return {booking: booking};
    } catch(error) {
        logger.warn("getProjectTeamForUser error: " + error);
        throw error;
    }
}
// *********************************************************************************************************************
// Get freelancers for user
// *********************************************************************************************************************
async function getFreelancers(args, kwargs) {
    try {
        logger.debug('getFreelancers ' + kwargs.user);
        const freelancers = await db.getFreelancers(kwargs.user);
        return {freelancers: freelancers};
    } catch(error) {
        logger.warn("getFreelancers error: " + error);
        throw error;
    }
}
// ---------------------------------------------------------------------------------------------------------------------
//    D E B U G
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// Get pusher clients (for debug)
// *********************************************************************************************************************
function getPusherClients() {
    try {
        return pusherClient.getClients()
    } catch(error) {
        logger.warn("getPusherClients error: " + error);
        throw error;
    }
}