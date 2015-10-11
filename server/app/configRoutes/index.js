module.exports = function(app) {

    require('./authentication')(app);
    require('./s3Storage')(app);
};
