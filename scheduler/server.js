'use strict';

const connectDb = require('./_common/mongodb-connect');
const wamp = require('./src/wamp');
const mongoose = require('mongoose');
const schedule = require('node-schedule');

const version = require('./package.json').version;
const logger = require('./src/logger');

const k2Job = require('./src/scheduledJobs/k2');
const pusherJob = require('./src/scheduledJobs/pusher');
const maintenanceJob = require('./src/scheduledJobs/maintenance');
const worklogUpdateJob = require('./src/scheduledJobs/worklogUpdate');
const workRequestJob = require('./src/scheduledJobs/workRequest');
const projectArchiveJob = require('./src/scheduledJobs/projectArchive');
const freelancerReminderJob = require('./src/scheduledJobs/freelancerReminder');
const dbBackupJob = require('./src/scheduledJobs/dbBackup');

logger.info(`Chameleon Scheduler version: ${version}, (${process.env.NODE_ENV === 'production' ? 'production' : 'development'})`);



const scheduledJobs = {
    "maintenance": {timing: process.env.SCHEDULER_TIMING_MAINTENANCE, job: maintenanceJob},
    "k2": {timing: process.env.SCHEDULER_TIMING_K2, job: k2Job},
    "pusher": {timing: process.env.SCHEDULER_TIMING_PUSHER, job: pusherJob, args: [false, true]},
    "worklog-update": {timing: process.env.SCHEDULER_TIMING_WORKLOG_UPDATE, job: worklogUpdateJob},
    "work-request": {timing: process.env.SCHEDULER_TIMING_WORK_REQUEST, job: workRequestJob},
    "project-archive": {timing: process.env.SCHEDULER_TIMING_PROJECT_ARCHIVE, job: projectArchiveJob},
    "freelancer-reminder": {timing: process.env.SCHEDULER_TIMING_FREELANCER_REMINDER, job: freelancerReminderJob},
    "db-backup": {timing: process.env.SCHEDULER_TIMING_DB_BACKUP, job: dbBackupJob}
};


(async () => {
    await wamp.open();
    await connectDb();

    for(const job of Object.keys(scheduledJobs)) {
        if(scheduledJobs[job].timing) {
            scheduledJobs.timer = schedule.scheduleJob(scheduledJobs[job].timing, () => scheduledJobs[job].job.apply(this, scheduledJobs[job].args));
            logger.debug(`Scheduling job '${job}' - timing ${scheduledJobs[job].timing}`);
        } else {
            logger.info(`Scheduled job '${job}' have not set timing - DISABLED.`);
        }
    }

})();

// *********************************************************************************************************************
// gracefully shutdown
// *********************************************************************************************************************
const signals = {
    'SIGINT': 2,
    'SIGTERM': 15
};

Object.keys(signals).forEach(signal => {
    process.on(signal, async () => {
        try {
            logger.info(`Received Signal ${signal}, shutting down.`);
            // WAMP
            await wamp.close();
            logger.info(`WAMP disconnected.`);
            // Mongo DB
            logger.info('Disconnecting MongoDb...');
            await mongoose.connection.close();
            logger.info(`MongoDb disconnected.`);
            // Shutdown
            process.exit(128 + signals[signal]);
        } catch(e) {
            logger.warn(`Error during shutdown. ${e}`);
            process.exit(1)
        }
    });
});
