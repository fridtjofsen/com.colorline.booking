'use strict';

const Homey = require('homey');

class ColorLineApp extends Homey.App {
  async onInit() {
    this.log('Color Line Connect has been initialized');
  }
}

module.exports = ColorLineApp;
