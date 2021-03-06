/*global module:false*/
module.exports = function(grunt) {

    var config      = require("./package.json");

    //console.log(process.env);
    var defaultTask = 'concat min lint';
    defaultTask += ' exec:' + ((process.env.bcc_env) ? 'env_' + process.env.bcc_env : 'env_prod');
    defaultTask += ' exec:remove_backup_files';

    // Project configuration
    // -------------------------------------------------- //

    grunt.initConfig({
        meta: {
          name: config.name,
          organization: config.organization,
          website: config.homepage,
          banner: ['/*',
            ' <%= meta.name %>',
            ' <%= meta.website %>',
            ' Copyright (c) <%= grunt.template.today("yyyy") %> <%= meta.organization %>',
            ' Licensed under the MIT License defined in the ',
            ' LICENSE file.  You may not use this file except in ',
            ' compliance with the License.',
            '/'].join("\n *") + "\n"
        },

        concat: {
            scripts: {
                src: ['src/bcc_*.js'],
                dest: 'build/bcc.js'
            }
        },

        lint: {
            files: ['grunt.js', 'src/bcc_*.js', 'tests/spec/*.js']
        },
        
        min: {
            scripts: {
                src: ['<banner:meta.banner>', '<config:concat.scripts.dest>'],
                dest: 'build/bcc.min.js'
            }
        },
        
        jasmine: {
            all: {
                src: ['tests/headless.html'],
                timeout: 300000, // 5 minutes in milliseconds
                errorReporting: true
            }
        },

        jshint: {
          "options": {
            "evil": true,
            "eqeqeq": false,
            "eqnull": true,
            "smarttabs": true,
            "browser": true,
            "node": true,
            "devel": true
          }
        },
        
        watch: {
            testing: {
                files: "tests/**/*.js",
                tasks: "jasmine"
            },
            javascript: {
                files: '<config:lint.files>',
                tasks: "lint"
            }
        },

        exec: {
          env_local: {
            command: "sed -i'.bak' -e 's/\\$jsbaseURL\\$/http:\\/\\/localhost:9092\\//g;s/\\$jsbaseStaticURL\\$/http:\\/\\/static.bcclabs.com\\/pub\\/js\\/sdk/g' build/*.js"
          },
          env_test: {
            command: "sed -i'.bak' -e 's/\\$jsbaseURL\\$/http:\\/\\/pub.bcclabs.com\\//g;s/\\$jsbaseStaticURL\\$/http:\\/\\/static.bcclabs.com\\/pub\\/js\\/sdk/g' build/*.js"
          },
          env_test2: {
            command: "sed -i'.bak' -e 's/\\$jsbaseURL\\$/http:\\/\\/pub.bccstudio.com\\//g;s/\\$jsbaseStaticURL\\$/http:\\/\\/static.bccstudio.com\\/pub\\/js\\/sdk/g' build/*.js"
          },
          env_prod: {
            command: "sed -i'.bak' -e 's/\\$jsbaseURL\\$/http:\\/\\/pub.brightcontext.com\\//g;s/\\$jsbaseStaticURL\\$/http:\\/\\/static.brightcontext.com\\/pub\\/js\\/sdk/g' build/*.js"
          },
          remove_backup_files: {
            command: "rm build/*.bak"
          }
        }

    });

    // Default task.
    grunt.registerTask('default', defaultTask);

    // Additional Packages
    grunt.loadNpmTasks('grunt-jasmine-task');
    grunt.loadNpmTasks('grunt-exec');
};
