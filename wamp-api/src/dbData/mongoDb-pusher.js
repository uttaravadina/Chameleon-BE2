'use strict';

require('mongoose');
const moment = require('moment');
const logger = require('../logger');
const dataHelper = require('../lib/dataHelper');
const taskHelper = require('../lib/taskHelper');

//Collections
const PusherWorklog = require('../models/pusher-worklog');
const User = require('../models/user');
const BookingResource = require('../models/booking-resource');
const PusherWorkclock = require('../models/pusher-workclock');
const PusherWorkclockNotify = require('../models/pusher-workclock-notify');
const PusherTask = require('../models/pusher-task');
const PusherMessage = require('../models/pusher-message');
const BookingProject = require('../models/booking-project');
const BookingEvent = require('../models/booking-event');
const PusherGroup = require('../models/pusher-group');
require('../models/booking-project');
require('../models/booking-work-type');

const PUSHER_BOOKING_TIME_SPAN = 7; //number of days, where the pusher is looking for next day items to show real next active day, otherwise shows tomorrow (empty)

// ---------------------------------------------------------------------------------------------------------------------
//    T A S K S
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// GET TASKS FOR USER
// *********************************************************************************************************************
exports.getTasksForUser = async user => {
    const userData = await User.findOne({ssoId: user}, {_id: true}).lean();
    if(userData) {
        const users = await getUsers(); //for normalization
        const allTasks = await PusherTask.find({},{dataOrigin: true, dataTarget: true, project: true, resolved: true, type: true, timestamp:true}).lean(); //for conditions
        const userTasks = await PusherTask.find({target: userData._id, resolved: null},{__v: false, resolved: false, dataTarget: false}).populate('project');
        for(const task of userTasks) { //update conditionsMet
            const currentConditionsMet = taskHelper.evaluateTaskConditions(task, task.project ? task.project._id : null, (task.dataOrigin && task.dataOrigin.onAir && task.dataOrigin.onAir._id ? task.dataOrigin.onAir._id : null), allTasks);
            if(task.conditionsMet !== currentConditionsMet) {
                task.conditionsMet = currentConditionsMet;
                await task.save();
            }
        }
        const activeTasks =  userTasks.filter(task => task.conditionsMet);
        return await Promise.all(activeTasks.map(task => taskHelper.normalizeTask(task, users)));
    } else throw new Error(`Can't find user ${user}`);
};
// *********************************************************************************************************************
// GET USERS BY ROLE
// *********************************************************************************************************************
exports.getUsersByRole = async role => {
    if(!role) throw new Error('GetUsersByRole - No role is specified!');
    const query = Array.isArray(role) ? {$or : role.map(r => {return {role: r}})} : {role: role};
    const users = await User.find(query).lean();
    return users.map(user => {return {id: user._id.toString(), label: user.name}}).sort((a,b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
};
// *********************************************************************************************************************
// POSTPONE TASK
// *********************************************************************************************************************
exports.postponeTask = async (id, days) => {
    return await PusherTask.findOneAndUpdate({_id: id}, {$inc: {postpone: days}}, {new : true});
};

// ---------------------------------------------------------------------------------------------------------------------
//    M E S S A G E S  +  C R E A T E
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// GET MESSAGES FOR USER
// *********************************************************************************************************************
exports.getMessagesForUser = async user => {
    const userData = await User.findOne({ssoId: user}, {_id: true}).lean();
    if(userData) {
        const users = await getUsers(); //for normalization
        const userMessages = await PusherMessage.find({target: userData._id}, {__v: false}).lean();
        const activeMessages = userMessages.filter(message => {
            const targetIndex = message.target.reduce((targetIndex, target, index) => target.toString() == userData._id.toString() ? index : targetIndex, -1);
            return targetIndex >= 0 && message.confirmed[targetIndex] === null;
        });
        return await Promise.all(activeMessages.map(message => taskHelper.normalizeMessage(message, users, userData._id)));
    } else throw new Error(`Can't find user ${user}`);
};
// *********************************************************************************************************************
// GET GROUPS AND USERS FOR CREATE MESSAGE
// *********************************************************************************************************************
exports.getUsersAndGroupsForCreate = async user => {
    const allUsers = await User.find({$or: [{access: 'pusher:app'},{access: 'pusher:email'}]}).lean();
    const owner = allUsers.find(u => u.ssoId === user);
    const query = owner ? {$or: [{owner: null}, {owner: owner}]} : {owner: null};
    const sets = await PusherGroup.find(query).lean();
    const users = allUsers.map(user => {return {id: user._id.toString(), label: user.name, hasPusher: user.access.indexOf('pusher:app') >= 0}}).sort(sortByLabel);
    const usersMap = users.reduce((map, user) => {
        map[user.id] = user.label;
        return map;
    }, {});
    const globalGroups =   sets.filter(set => set.owner === null).map(set => {return {label: set.label, id: set._id, members: set.members.map(member => member.toString()).filter(member => !!usersMap[member]).sort((a, b) => sortMembersByLabel(a, b, usersMap))}}).sort(sortByLabel);
    const personalGroups = sets.filter(set => set.owner !== null).map(set => {return {label: set.label, id: set._id, members: set.members.map(member => member.toString()).filter(member => !!usersMap[member]).sort((a, b) => sortMembersByLabel(a, b, usersMap))}}).sort(sortByLabel);
    globalGroups.unshift({
        label: 'All users',
        id: null,
        members: users.map(u => u.id)
    });
    return {
        users: users,
        globalGroups: globalGroups.filter(group => group.members.length > 0),
        personalGroups: personalGroups.filter(group => group.members.length > 0)
    }
};
// *********************************************************************************************************************
// CREATE GROUPS AND USERS FOR CREATE MESSAGE
// *********************************************************************************************************************
exports.createUserGroupForCreate = async (id, label, members, owner) => {
    const user = await User.findOne({ssoId: owner}, {_id: true}).lean();
    await PusherGroup.create({_id: id, owner: user._id, label: label, members: members});
};
// *********************************************************************************************************************
// UPDATE GROUPS AND USERS FOR CREATE MESSAGE
// *********************************************************************************************************************
exports.updateUserGroupForCreate = async (id, members) => {
    await PusherGroup.findOneAndUpdate({_id: id}, {$set: {members: members}});
};
// *********************************************************************************************************************
// REMOVE GROUPS AND USERS FOR CREATE MESSAGE
// *********************************************************************************************************************
exports.removeUserGroupForCreate = async id => {
    await PusherGroup.findOneAndRemove({_id: id});
};
// *********************************************************************************************************************
// TODO ADD MESSAGE
// *********************************************************************************************************************
exports.addMessage = async message => {
    if(!message) return [];
    logger.debug('addMessage');
    logger.debug(JSON.stringify(message));
    return [];
};

// ---------------------------------------------------------------------------------------------------------------------
//    W O R K  -  C L O C K
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// GET WORK-CLOCK FOR USER
// *********************************************************************************************************************
exports.getWorkClock = async (userId, isSsoId) => {
    if(isSsoId) {
        const user = await User.findOne({ssoId: userId}, {_id: true}).lean();
        userId = user ? user._id.toString() : null;
    }
    const workClock = await PusherWorkclock.findOne({user: userId}).sort({timestamp: -1}).lean();
    return workClock ? workClock.state : 'OUT';
};

// *********************************************************************************************************************
// SET WORK-CLOCK FOR USER
// *********************************************************************************************************************
exports.setWorkClock = async (ssoId, state) => {
    const user = await User.findOne({ssoId: ssoId}, {_id: true}).lean();
    if(user) {
        await PusherWorkclock.create({user: user._id, state: state});
        const requests = await PusherWorkclockNotify.find({subject: user._id, notified: null, canceled: null}).populate('user');
        const toNotify = {};
        for(const request of requests) {
            request.notified = Date.now();
            if(!toNotify[request.user.ssoId]) toNotify[request.user.ssoId] = request.user;
            await request.save();
        }
        return {user: user, toNotify: Object.keys(toNotify).map(u => toNotify[u])};
    } else {
        throw new Error(`Can't find user ${ssoId}`);
    }
};

// ---------------------------------------------------------------------------------------------------------------------
//    W O R K  -  L O G
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// GET WORK-LOGS FOR USER
// *********************************************************************************************************************
exports.getWorklogsForUser = async (user, full) => {
    const userIds = await exports.getUserBySsoId(user);
    const logs = await PusherWorklog.find({approved: false}).populate('project job operatorJob').lean();
    const projectsWithLogs = logs.reduce((output, log) => {
        const logK2id = log.operatorName.toLowerCase() + '.' + log.operatorSurname.toLowerCase();

        const logApproval = getLogStatus(log); //current status of log approval
        let logUserRole = getLogRole(log, userIds); //user's role(s) for the project which log belongs to

        // if user has any role for this log and it is not log about own work (excluded manager but it should never happen)
        let sendToThisUser =  !log.resolve && logUserRole.length > 0 && (logK2id != userIds.K2id || log.project.manager == userIds.id);

        // exclude if approval is already done by this user (role)
        if(sendToThisUser) {
            sendToThisUser = logUserRole.reduce((out, role) => {
                if (logApproval[role] === 0) return true;
                else return out;
            }, false);
        }
        // if user is manager of the project and it is not send by previous conditions
        // all approval are done but obviously still not approved - it means need final decision from manager
        // ANY WEIRED approval
        let managersDecision = false;
        if(full || (!log.resolve && !sendToThisUser && logUserRole.indexOf('manager') >= 0)) { //} log.project.manager == userIds.id)) {
            const complete = logApproval.manager !== 0 && logApproval.supervisor !== 0 && logApproval.lead2D !== 0 && logApproval.lead3D !== 0 && logApproval.producer !== 0 && logApproval.leadMP !== 0;
            const someWeired = logApproval.manager === 3 || logApproval.supervisor === 3 || logApproval.lead2D === 3 || logApproval.lead3D === 3 || logApproval.producer === 3 || logApproval.leadMP === 3;
            const someOk = logApproval.manager === 1 || logApproval.supervisor === 1 || logApproval.lead2D === 1 || logApproval.lead3D === 1 || logApproval.producer === 1 || logApproval.leadMP === 1;

            managersDecision = complete && (someWeired || !someOk);

            sendToThisUser = managersDecision;
        }
        if(full) {
            sendToThisUser = true;
            logUserRole = ['manager','supervisor','lead2D','lead3D', 'leadMP', 'producer'];
        }
        // if user is producer and log needs to be resolved
        if(!sendToThisUser && log.resolve && userIds.role.indexOf('booking:worklog-resolver') >= 0) {// PRODUCERS.indexOf(user) >= 0 ) {
            sendToThisUser = true;
        }
        if(sendToThisUser) {
            const _log = {
                id: log._id,
                operator: log.operatorName.toUpperCase() + ' ' + log.operatorSurname.toUpperCase(),
                date: moment(log.date).format(),
                work: log.job.shortLabel,
                hours: log.hours,
                description: log.description,
                roles: logUserRole,
                approval: logApproval,
                finalApprove: managersDecision,
                resolve: log.resolve
            };
            if(output[log.project._id]) {
                output[log.project._id].logs.push(_log);
            } else {
                output[log.project._id] = {
                    id: log.project._id,
                    label: log.project.label,
                    logs: [_log]
                }
            }
            return output;
        } else return output;

    }, {});

    // convert object to array and sort  logs by date
    const result = Object.keys(projectsWithLogs).map(projectId => {
        const project = projectsWithLogs[projectId];
        project.logs = project.logs.sort((a,b) => {
            const aa = a.resolve ? 2 : a.finalApprove ? 1 : 0;
            const bb = b.resolve ? 2 : b.finalApprove ? 1 : 0;
            const importanceComare = aa - bb;
            if(importanceComare !== 0) return importanceComare;
            const dateCompare = new Date(a.date) - new Date(b.date);
            if(dateCompare !== 0) return dateCompare;
            const operatorCompare =  (a.operator < b.operator) ? -1 : (a.operator > b.operator) ? 1 : 0;
            if(operatorCompare !== 0) return operatorCompare;
            const hoursCompare = b.hours - a.hours;
            if(hoursCompare !== 0) return hoursCompare;
            return (a.description < b.description) ? -1 : (a.description > b.description) ? 1 : 0;
        });
        return project;
    });

    return result.sort((a, b) => {return (a.label < b.label) ? -1 : (a.label > b.label) ? 1 : 0});
};

// ---------------------------------------------------------------------------------------------------------------------
//    G E T  O T H E R  D A T A
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// GET ALL USERS (with workclock and requests by user)
// *********************************************************************************************************************
exports.getAllUsers = async forUser => {
    const forUserId = await User.findOne({ssoId: forUser}, {_id: true}).lean();
    const _users = await User.find({},{name: true, ssoId: true, role: true, access: true, tlf: true, email: true, resource: true}).lean();
    const users = _users.filter(user => user.access.indexOf('pusher:app') >= 0).map(user => ({
        id: user._id.toString(),
        ssoId: user.ssoId,
        name: user.name,
        role: user.role.filter(role => role.indexOf('booking:') === 0),
        email: user.email,
        tlf: user.tlf,
        resource: user.resource
    }));
    for(const user of users) {
        user.clock = await exports.getWorkClock(user.id);
        user.requested = await getWorkClockRequestedByUser(user.id, forUserId ? forUserId._id.toString() : null);
    }
    return users.reduce((out, user) => {
        out[user.id] = user;
        return out;
    }, {});
};

async function getWorkClockRequestedByUser(subject, user) { //get requests for subject by user
    if(!user || !subject) return false;
    const requests = await PusherWorkclockNotify.find({user: user, subject: subject, notified: null, canceled: null}, {_id: true}).lean();
    return requests.length > 0;
}
// *********************************************************************************************************************
// GET PROJECT TEAM FOR USER
// *********************************************************************************************************************
exports.getProjectTeamForUser = async user => {
    const today = moment().startOf('day');
    const days = []; //array for every day in time span of {date, timings [], projects []}
    for(let i = 0; i < PUSHER_BOOKING_TIME_SPAN; i++) days.push({date: today.clone().add(i, 'days'), timings: [], projects: []});
    const userIds = await exports.getUserBySsoId(user);
    const projects = await BookingProject.find({timing: {$gt: []}, $or: [{manager: userIds.id}, {supervisor: userIds.id}, {lead2D: userIds.id}, {lead3D: userIds.id}, {leadMP: userIds.id}/*, {producer: userIds.id}*/], deleted: null, offtime: {$ne: true}, internal: {$ne: true}, confirmed: true}, {label:true, timing:true, lead2D: true, lead3D: true, leadMP: true, manager: true, supervisor: true, producer: true}).lean();
    projects.forEach(project => {
        const isManagerOrSupervisor = (project.manager && project.manager.toString() === userIds.id) || (project.supervisor && project.supervisor.toString() === userIds.id);
        project.timing.forEach(timing => {
            if(isManagerOrSupervisor || timing.type === 'UPP') {
                const timingDate = moment(timing.date).startOf('day');
                const dayIndex = timingDate.diff(today, 'days');
                if(dayIndex >= 0 && days.length > dayIndex) {
                    days[dayIndex].timings.push({type: timing.type, category: timing.category, text: timing.text, project: project.label});
                    if(dayIndex > 0 ) days.length = dayIndex + 1; //shorten time span to latest date + today
                }
            }
        })
    });
    // get all events in time span from today where not offtime and operator is defined
    const regionStart = moment.utc().startOf('day').valueOf(); //startDate on event is without TZ !!!!
    const regionEnd = moment.utc().endOf('day').add(days.length - 1, 'day').valueOf(); //end of day of  last region day - included
    const eventStart = 'this.startDate.getTime()';
    const eventEnd = '(this.startDate.getTime() + (this.days.length * 24 * 3600000))';

    const query = {$where : `(${eventStart} <= ${regionEnd}) && (${eventEnd} > ${regionStart})`, operator: {$ne: null}, offtime: {$ne: true}};
    const events = await BookingEvent.find(query, {__v: false, efficiency: false, notes: false, offtime: false, label: false})
        .populate('operator facility job')
        .populate({path: 'project', populate: {path: 'manager supervisor lead2D lead3D leadMP producer', select: 'name'}, select: 'label manager supervisor lead2D lead3D leadMP producer deleted internal confirmed'})
        .lean();

    const activeProjects = events.filter(event => !event.project.deleted && !event.project.internal).reduce((projects, event) => {
        const projectId = event.project._id.toString();
        const isEventOperator = userIds.resource && event.operator ? event.operator._id.toString() === userIds.resource : false;
        if(!projects[projectId]) {
            const role = {
                manager: event.project.manager ? event.project.manager._id.toString() === userIds.id : false,
                supervisor: event.project.supervisor ? event.project.supervisor._id.toString() === userIds.id : false,
                lead2D: event.project.lead2D ? event.project.lead2D._id.toString() === userIds.id : false,// && event.job && ['2D', 'MP'].indexOf(event.job.type) >= 0 : false, //lead - team only if job is...
                lead3D: event.project.lead3D ? event.project.lead3D._id.toString() === userIds.id : false, //&& event.job && ['3D', 'MP'].indexOf(event.job.type) >= 0 : false,
                leadMP: event.project.leadMP ? event.project.leadMP._id.toString() === userIds.id : false, //&& event.job && event.job.type === 'MP' : false
                producer: event.project.producer ? event.project.producer._id.toString() === userIds.id : false
            };
            projects[projectId] = {
                role: (role.supervisor || role.manager || role.leadMP || role.lead3D || role.lead2D /*|| role.producer*/) ? role : null,
                label: event.project.label,
                manager: event.project.manager ? {id: event.project.manager._id.toString(), label: event.project.manager.name} : null,
                supervisor: event.project.supervisor ? {id: event.project.supervisor._id.toString(), label: event.project.supervisor.name} : null,
                lead2D: event.project.lead2D ? {id: event.project.lead2D._id.toString(), label: event.project.lead2D.name} : null,
                lead3D: event.project.lead3D ? {id: event.project.lead3D._id.toString(), label: event.project.lead3D.name} : null,
                leadMP: event.project.leadMP ? {id: event.project.leadMP._id.toString(), label: event.project.leadMP.name} : null,
                producer: event.project.producer ? {id: event.project.producer._id.toString(), label: event.project.producer.name} : null,
                id: projectId,
                events: []
            }
        }
        const startDateIndex = today.diff(moment(event.startDate, 'YYYY-MM-DD').startOf('day'), 'days');
        const eventDays = [];
        for(let i = 0; i < days.length; i++) {
            if(startDateIndex + i >= 0 && startDateIndex + i < event.days.length && event.days[startDateIndex + i].duration > 0) {
                eventDays.push({
                    float: event.days[startDateIndex + i].float,
                    start: event.days[startDateIndex + i].start,
                    duration: event.days[startDateIndex + i].duration,
                    isEventOperator: isEventOperator
                })
            } else eventDays.push(null)
        }
        if(eventDays.some(day => !!day)) {
            projects[projectId].events.push({
                isEventOperator: isEventOperator,
                operator: event.operator ? event.operator.virtual && event.virtualOperator ? `~${event.virtualOperator}` : `${event.operator.virtual ? '~' : ''}${event.operator.label}` : '',
                operatorId: event.operator ? event.operator._id : null,
                days: eventDays,
                facility: event.facility ? event.facility.label : null,
                facilityTlf: event.facility && event.facility.tlf ? event.facility.tlf : null,
                isShooting: event.isShooting,
                confirmed: event.confirmedAsProject ? event.project.confirmed : event.confirmed
            });
        }
        return projects;
    }, {});
    for(let i = 0; i< days.length; i++) {
        for (let projectId in activeProjects) {
            if (activeProjects.hasOwnProperty(projectId)) {
                const events = activeProjects[projectId].events.filter(event => event.days[i] !== null);
                const operatorRole = events.some(event => event.isEventOperator);
                if (operatorRole || (activeProjects[projectId].role && events.length > 0)) {
                    days[i].projects.push({
                        id: activeProjects[projectId].id,
                        label: activeProjects[projectId].label,
                        role: activeProjects[projectId].role,
                        manager: activeProjects[projectId].manager,
                        supervisor: activeProjects[projectId].supervisor,
                        lead2D: activeProjects[projectId].lead2D,
                        lead3D: activeProjects[projectId].lead3D,
                        leadMP: activeProjects[projectId].leadMP,
                        producer: activeProjects[projectId].producer,
                        events: events.map(event => {
                            return {
                                isEventOperator: event.isEventOperator,
                                operator: event.operator,
                                operatorId: event.operatorId,
                                facility: event.facility,
                                facilityTlf: event.facilityTlf,
                                isShooting: event.isShooting,
                                confirmed: event.confirmed,
                                time: {
                                    float: event.days[i].float,
                                    start: event.days[i].start,
                                    duration: event.days[i].duration
                                }
                            }

                        })
                    });
                    if (i > 0) days.length = i + 1; //shorten time span to latest date + today
                }
            }
        }
    }
    delete days[0].date;
    const myDay = days[0].timings.length > 0 || days[0].projects.length > 0 ? days[0] : null;
    const nextDay = days.length > 1 && (days[days.length - 1].timings.length > 0 || days[days.length - 1].projects.length > 0) ? days[days.length - 1] : null;

    if(myDay && myDay.timings && myDay.timings.length > 0) myDay.timings = dataHelper.timingReduce(myDay.timings);
    if(nextDay && nextDay.timings && nextDay.timings.length > 0) nextDay.timings = dataHelper.timingReduce(nextDay.timings);
    if(nextDay) nextDay.date = nextDay.date.format('YYYY-MM-DD');
    return {myDay, nextDay};
};
// *********************************************************************************************************************
// GET FREELANCERS
// *********************************************************************************************************************
exports.getFreelancers = async userSsoId => {
    const user = userSsoId ? await User.findOne({ssoId: userSsoId}, {_id: true, role: true}).lean() : null;
    const isHR = user && (user.role.indexOf('booking:hr-manager') >= 0 || user.role.indexOf('booking:main-manager') >= 0);
    const userId = user ? user._id.toString() : null;

    const events = await BookingEvent.find({offtime: false}, {startDate: true, days: true, project: true, operator: true}).populate({path: 'project', select: 'label manager internal deleted'}).populate({path: 'operator', select: 'virtual freelancer confirmed label'}).lean();


    const resources = isHR ? await BookingResource.find({type: 'OPERATOR', $or: [{virtual: true}, {freelancer: true}], confirmed:{$exists: true, $ne: []}}, {virtual: true, freelancer: true, label: true, confirmed: true}).lean() : [];
    const freelancers = resources.map(resource => {
        return {
            id: resource._id.toString(),
            virtual: resource.virtual,
            freelancer: resource.freelancer,
            label: resource.label,
            confirmed: resource.confirmed.map(confirmation => {
                return {
                    from: moment(confirmation.from).startOf('day'),
                    to: moment(confirmation.to).startOf('day')
                }
            })
        }
    });

    const unconfirmedFreelancers = {};
    const confirmedFreelancers = {};

    const today = moment().startOf('day');

    for(const freelancer of freelancers) {
        for(const confirmation of freelancer.confirmed) {
            let from = confirmation.from;
            let to = confirmation.to;
            if(to.diff(today, 'days') >= 0) {
                if(today.diff(from, 'days') >= 0) from = today.clone();
                if(!confirmedFreelancers[freelancer.id]) confirmedFreelancers[freelancer.id] = {
                    freelancer: {
                        id: freelancer.id,
                        label: freelancer.label,
                        remote: freelancer.virtual
                    },
                    dates: []
                };
                const confirmationLength = to.diff(from, 'days') + 1;
                for(let i = 0; i < confirmationLength; i++) {
                    const dayString = from.clone().add(i, 'day').format('YYYY-MM-DD');
                    if(confirmedFreelancers[freelancer.id].dates.indexOf(dayString) < 0) confirmedFreelancers[freelancer.id].dates.push(dayString);
                }
            }
        }
    }

    const activeEvents = events.filter(event => {
        if(event.project.internal || event.project.deleted) return false; // no internal or deleted projects
        if(userId && !isHR && (!event.project.manager || event.project.manager.toString() !== userId)) return false; //only if user is manager or HR
        if(!event.operator || (!event.operator.virtual && !event.operator.freelancer)) return false;// event operator is not freelancer or virtual
        const endDay = moment(event.startDate, 'YYYY-MM-DD').add((event.days.length - 1), 'days').startOf('day');
        if(endDay.diff(moment().startOf('day'), 'days') < 0) return false; //only event having any day equal today and late
        return true;
    });

    for(const event of activeEvents) {
        const day = moment(event.startDate, 'YYYY-MM-DD').startOf('day');
        const projectId = event.project._id.toString();
        const operatorId = event.operator._id.toString();
        const isManager = event.project.manager && event.project.manager.toString() === userId;
        for(let i = 0; i < event.days.length; i++) {
            if(day.diff(today, 'days') >= 0 && event.days[i].duration > 0) { //event day from today and duration > 0
                if (isFreelancerConfirmed(event.operator.confirmed, day)) {
                    if(confirmedFreelancers[operatorId]) {
                        const di = confirmedFreelancers[operatorId].dates.indexOf(day.format('YYYY-MM-DD'));
                        if(di >= 0) confirmedFreelancers[operatorId].dates.splice(di, 1);
                    }
                } else if(isManager) {
                    if(!unconfirmedFreelancers[`${projectId}-${operatorId}`]) unconfirmedFreelancers[`${projectId}-${operatorId}`]= {
                        project: {
                            id: projectId,
                            label: event.project.label,
                        },
                        freelancer: {
                            id: operatorId,
                            label: event.operator.label,
                            remote: event.operator.virtual
                        },
                        dates: []
                    };
                    unconfirmedFreelancers[`${projectId}-${operatorId}`].dates.push(day.format('YYYY-MM-DD'));
                }
            }
            day.add(1, 'day');
        }
    }

    return {
        confirmed: isHR ? Object.keys(confirmedFreelancers).map(key => {
            return {
                freelancer: confirmedFreelancers[key].freelancer,
                dates: compactDates(confirmedFreelancers[key].dates)
            }
        }).filter(obj => obj.dates.length > 0) : [],
        unconfirmed: Object.keys(unconfirmedFreelancers).map(key => {
            return {
                freelancer: unconfirmedFreelancers[key].freelancer,
                project: unconfirmedFreelancers[key].project,
                dates: compactDates(unconfirmedFreelancers[key].dates)
            }
        }).filter(obj => obj.dates.length > 0)
    };
};
// *********************************************************************************************************************
// GET USER BY SSO-ID
// *********************************************************************************************************************
exports.getUserBySsoId = async (ssoId, nullIfNotFound) => {
    const user = await User.findOne({ssoId: ssoId}).lean();
    if(!user) {
        if(nullIfNotFound) return null;
        else throw new Error(`No user for ssoId: ${ssoId}`);
    }
    const resource = await BookingResource.findOne({_id: user.resource}, {K2id: true}).lean();
    return {id: user._id.toString(), resource: resource ? resource._id.toString() : null, K2id: resource ? resource.K2id : null, name: user.name, email: user.email ? user.email : null, role: user.role, access: user.access};
};
// *********************************************************************************************************************
// GET SSO-ID(s) for UID(s)
// *********************************************************************************************************************
exports.getSsoIdsForUsers = async uid => {
    if(!uid) return null;
    if(Array.isArray(uid)) {
        const users = await Promise.all(uid.map(id => User.findOne({_id: id}).lean()));
        return users.map(u => u && u.ssoId ? u.ssoId : null);
    } else {
        const user =  User.findOne({_id: uid}).lean();
        return user && user.ssoId ? user.ssoId : null;
    }
};

// ---------------------------------------------------------------------------------------------------------------------
//    H E L P E R S
// ---------------------------------------------------------------------------------------------------------------------
// *********************************************************************************************************************
// current status of log for all relevant approvers 0 = not approved, 1,2,3 = approved ok, maybe, wired, 4 = own log, 5 = approve is not required
function getLogStatus(log) {
    const logOperator = log.operator ? log.operator.toString() : null; //user ID
    // if project role exists => set log status otherwise 5
    const logStatus = {
        manager: log.project.manager ? log.confirmManager : 5,
        supervisor: log.project.supervisor ? log.confirmSupervisor : 5,
        lead2D: log.project.lead2D ? log.confirm2D : 5,
        lead3D: log.project.lead3D ? log.confirm3D : 5,
        leadMP: log.project.leadMP ? log.confirmMP : 5
    };
    // if it is own log - set 4
    if(log.project.manager  && log.project.manager == logOperator) logStatus.manager = 4;
    if(log.project.supervisor  && log.project.supervisor == logOperator) logStatus.supervisor = 4;
    if(log.project.lead2D  && log.project.lead2D == logOperator) logStatus.lead2D = 4;
    if(log.project.lead3D  && log.project.lead3D == logOperator) logStatus.lead3D = 4;
    if(log.project.leadMP  && log.project.leadMP == logOperator) logStatus.leadMP = 4;
    // set 5 if log.job.type is not required to be approved by the role
    switch(log.job.type) {
        case 'GR': // grading only manager
            logStatus.supervisor = 5;
            logStatus.lead2D = 5;
            logStatus.lead3D = 5;
            logStatus.leadMP = 5;
            break;
        case '2D': // 2D - manager, supervisor, lead2D
            logStatus.lead3D = 5;
            logStatus.leadMP = 5;
            break;
        case '3D': // 3D - manager, supervisor, lead3D
            logStatus.lead2D = 5;
            logStatus.leadMP = 5;
            break;
        case 'MP': // MP - all
            break;
        case 'SV': // SV - manager and supervisor
            logStatus.lead2D = 5;
            logStatus.lead3D = 5;
            logStatus.leadMP = 5;
            break;
        case 'OV':
        case 'TW': // OV and TW - if there is operator job -> lead2d = GR and 2D, lead3D = 3D, leadMP = MP
            if(log.operatorJob) {
                if(log.operatorJob.type !== '2D' && log.operatorJob.type !== 'GR') logStatus.lead2D = 5;
                if(log.operatorJob.type !== '3D') logStatus.lead3D = 5;
                if(log.operatorJob.type !== 'MP') logStatus.leadMP = 5;
            }
            break;
        //TODO solve DEV and SUP mapped to 2D, 3D, leads....
    }
    // producer approve log of supervisor of the project
    logStatus.producer = log.project.supervisor && log.project.supervisor == logOperator ? log.confirmProducer : 5;
    return logStatus;
}
// *********************************************************************************************************************
// user role for log
function getLogRole(log, userIds) {
    const logOperator = log.operator ? log.operator.toString() : null; //user ID
    const logUserRole = [];
    //TODO solve DEV and SUP mapped to 2D, 3D, leads....
    if(log.project.manager == userIds.id    &&    ['2D','3D','MP','GR','OV','TW','SV'].indexOf(log.job.type) >= 0) logUserRole.push('manager');
    if(log.project.supervisor == userIds.id &&    ['2D','3D','MP',     'OV','TW','SV'].indexOf(log.job.type) >= 0) logUserRole.push('supervisor');
    if(log.project.lead2D == userIds.id     &&   (['2D','MP'].indexOf(log.job.type) >= 0 || ((log.job.type === 'OV' || log.job.type === 'TW') && log.operatorJob && (log.operatorJob.type === '2D' || log.operatorJob.type === 'GR')))) logUserRole.push('lead2D');
    if(log.project.lead3D == userIds.id     &&   (['3D','MP'].indexOf(log.job.type) >= 0 || ((log.job.type === 'OV' || log.job.type === 'TW') && log.operatorJob && log.operatorJob.type === '3D'))) logUserRole.push('lead3D');
    if(log.project.leadMP == userIds.id     &&   (['MP'].indexOf(log.job.type) >= 0      || ((log.job.type === 'OV' || log.job.type === 'TW') && log.operatorJob && log.operatorJob.type === 'MP'))) logUserRole.push('leadMP');
    if(logOperator != userIds.id && userIds.role.indexOf('booking:main-producer') >= 0 && log.project.supervisor && log.project.supervisor == logOperator) logUserRole.push('producer');
    return logUserRole;
}
// *********************************************************************************************************************
async function getUsers() {
    const users = await User.find({},{__v: false}).lean();
    return dataHelper.getObjectOfNormalizedDocs(users);
}
// *********************************************************************************************************************
function isFreelancerConfirmed(confirmations, day) {
    if(!day || !confirmations) return false;
    for(const confirmation of confirmations) {
        if(day.diff(moment(confirmation.from).startOf('day'), 'days') >= 0 && moment(confirmation.to).startOf('day').diff(day, 'days') >= 0) {
            return true;
        }
    }
    return false;
}
// *********************************************************************************************************************
function compactDates(dateArray) {
    const dates = [];
    let from = null;
    let to = null;
    dateArray.sort();
    for(const date of dateArray) {
        if(!from) {
            from = date;
            to = date;
        } else {
            if(moment(date, 'YYYY-MM-DD').diff(moment(to, 'YYYY-MM-DD'), 'days') === 1) {
                to = date;
            } else {
                if(from === to) dates.push(from);
                else dates.push([from, to]);
                from = date;
                to = date;
            }
        }
    }
    if(from !== null) {
        if (from === to) dates.push(from);
        else dates.push([from, to]);
    }
    return dates;
}
// *********************************************************************************************************************
function sortByLabel(a, b) {
    return a.label.localeCompare(b.label);
}
// *********************************************************************************************************************
function sortMembersByLabel(a, b, usersMap) {
    const aa = usersMap[a];
    const bb = usersMap[b];
    if(aa && bb) {
        return aa.localeCompare(bb);
    } else return 0;
}
// *********************************************************************************************************************