var bluebird = require('bluebird'),
    mongoose = require('mongoose'),
    User = mongoose.model('User'),
    fs = require('fs'),
    AWS = require('aws-sdk'),
    shortId = require('shortid'),
    Zip = require('adm-zip'),
    s3 = new AWS.S3();

// Allow fs and s3 promises
bluebird.promisifyAll(fs);
bluebird.promisifyAll(s3);
User = bluebird.promisifyAll(User);

module.exports = function(app) {

    function readFsArray(inputArr) {
        var outputArr = [];
        inputArr.forEach(function(val, encoding) {
            console.log(val.slice(val.lastIndexOf('/') + 1, val.lastIndexOf('.')));
            console.log(val.slice(val.lastIndexOf('.') + 1));
            outputArr.push({
                name: val.slice(val.lastIndexOf('/') + 1, val.lastIndexOf('.')),
                ext: val.slice(val.lastIndexOf('.') + 1),
                file: fs.readFileSync(fs.existsSync(app.getValue('root') + val) ? app.getValue('root') + val : val, encoding)
            });
        });
        return outputArr;
    }

    //// making zips and posting to AWS S3
    app.post('*storeit', function(req, res, next) {
        console.log(req.body);
        var appName = req.body.appName ? req.body.appName : 'unNamedApp',
            htmlData = req.body.htmlStr ? {
                name: 'index',
                ext: 'html',
                file: req.body.htmlStr
            } : null,
            cssBuffs = readFsArray(req.body.cssArr, 'utf8'),
            imageBuffs = readFsArray(req.body.imagesArr, 'base64');

        //get output directories
        var uploadedAppZipDir,
            uploadedAppDir = uploadedAppZipDir = app.getValue('root') + appName;

        //make sure we don't overwrite an application file
        while ((fs.existsSync(uploadedAppZipDir + '.zip'))) {
            uploadedAppZipDir += '_';
        }
        uploadedAppZipDir += '.zip'; // append .zip extension
        while ((fs.existsSync(uploadedAppDir))) {
            uploadedAppDir += '_';
        }

        //make compressed file
        var newZip = new Zip();
        if (htmlData) newZip.addFile(htmlData.name + '.' + htmlData.ext, htmlData.file);
        cssBuffs.forEach(function(val) {
            newZip.addFile('assets/css/' + val.name + '.' + val.ext, val.file);
        });
        imageBuffs.forEach(function(val) {
            newZip.addFile('assets/images/' + val.name + '.' + val.ext, val.file);
        });
        newZip.writeZip(uploadedAppZipDir);

        // Write uncompressed file to root too, just for fun :)
        fs.mkdirAsync(uploadedAppDir).then(function(appFolder) {
            return htmlData ? fs.writeFileAsync(uploadedAppDir + '/' + htmlData.name + '.' + htmlData.ext, htmlData.file) : bluebird.resolve('no html file');
        }).then(function(htmlFile) {
            return fs.mkdirAsync(uploadedAppDir + '/assets');
        }).then(function(assetsFolder) {
            return fs.mkdirAsync(uploadedAppDir + '/assets/css');
        }).then(function(cssFolder) {
            cssBuffs.forEach(function(val) {
                fs.writeFileSync(uploadedAppDir + '/assets/css/' + val.name + '.' + val.ext, val.file);
            });
            return fs.mkdirAsync(uploadedAppDir + '/assets/images');
        }).then(function(imagesFolder) {
            imageBuffs.forEach(function(val) {
                fs.writeFileSync(uploadedAppDir + '/assets/images/' + val.name + '.' + val.ext, val.file);
            });
        });

        // AWS params object
        var awsZip = {
            Bucket: app.getValue('env').AWS.bucketName,
            Key: shortId.generate() + '.zip', //the shortId generates a unique string of characters each time
            Body: newZip.toBuffer()
        };

        // what we want to store
        modelZip = {
            name: appName,
            zipUrl: 'https://s3.amazonaws.com/' + awsZip.Bucket + '/' + awsZip.Key,
        };

        s3.putObjectAsync(awsZip).then(function(data) {
            console.log("Successfully uploaded data to " + modelZip.zipUrl);
            return User.findByIdAsync(req.user._id);
        }).then(function(user){
            user.apps.push(modelZip);
            return user.save();
        }).then(function(user){
            res.json(modelZip);
        }).catch(function(err) {
            console.log(err);
        });
    });
};
