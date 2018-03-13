///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import config from 'app/core/config';

import {CanvasPanelCtrl} from './canvas-metric';

import _ from 'lodash';
import $ from 'jquery';
import moment from 'moment';
import kbn from 'app/core/utils/kbn';

import appEvents from 'app/core/app_events';

class JoyPanelCtrl extends CanvasPanelCtrl {
  static templateUrl = 'partials/module.html';
  static scrollable = true;

  defaults = {
    display: 'timeline', // or 'stacked'
    rowHeight: 50,
    valueMaps: [{value: 'null', op: '=', text: 'N/A'}],
    rangeMaps: [{from: 'null', to: 'null', text: 'N/A'}],
    colorMaps: [{text: 'N/A', color: '#CCC'}],
    metricNameColor: '#000000',
    valueTextColor: '#000000',
    crosshairColor: '#8F070C',
    backgroundColor: 'rgba(128,128,128,0.1)',
    lineColor: 'rgba(0,0,0,0.1)',
    textSize: 24,
    extendLastValue: true,
    writeLastValue: true,
    writeAllValues: false,
    writeMetricNames: false,
    showLegend: true,
    showLegendNames: true,
    showLegendValues: true,
    showLegendPercent: true,
    highlightOnMouseover: true,
    expandFromQueryS: 0,
    legendSortBy: '-ms',
    units: 'short',
  };

  data: any = null;
  externalPT = false;
  isTimeline = false;
  isStacked = false;
  hoverPoint: any = null;
  colorMap: any = {};
  _colorsPaleteCash: any = null;
  unitFormats: any = null; // only used for editor
  formatter: any = null;

  _renderDimensions: any = {};
  _selectionMatrix: Array<Array<String>> = [];

  constructor($scope, $injector) {
    super($scope, $injector);

    // defaults configs
    _.defaultsDeep(this.panel, this.defaults);

    this.events.on('init-edit-mode', this.onInitEditMode.bind(this));
    this.events.on('render', this.onRender.bind(this));
    this.events.on('data-received', this.onDataReceived.bind(this));
    this.events.on('data-error', this.onDataError.bind(this));
    this.events.on('refresh', this.onRefresh.bind(this));

    this.onConfigChanged();
  }

  onDataError(err) {
    console.log('onDataError', err);
  }

  onInitEditMode() {
    this.unitFormats = kbn.getUnitFormats();

    this.addEditorTab(
      'Options',
      'public/plugins/natel-discrete-panel/partials/editor.options.html',
      1
    );
    this.editorTabIndex = 1;
    this.refresh();
  }

  onRender() {
    if (this.data == null || !this.context) {
      return;
    }

    this._updateRenderDimensions();
    this._updateSelectionMatrix();
    this._updateCanvasSize();

    this._renderCrosshair();
  }

  clearTT() {
    this.$tooltip.detach();
  }

  formatValue(val) {
    if (_.isNumber(val)) {
      if (this.panel.rangeMaps) {
        for (let i = 0; i < this.panel.rangeMaps.length; i++) {
          let map = this.panel.rangeMaps[i];

          // value/number to range mapping
          let from = parseFloat(map.from);
          let to = parseFloat(map.to);
          if (to >= val && from <= val) {
            return map.text;
          }
        }
      }
      if (this.formatter) {
        return this.formatter(val, this.panel.decimals);
      }
    }

    let isNull = _.isNil(val);
    if (!isNull && !_.isString(val)) {
      val = val.toString(); // convert everything to a string
    }

    for (let i = 0; i < this.panel.valueMaps.length; i++) {
      let map = this.panel.valueMaps[i];
      // special null case
      if (map.value === 'null') {
        if (isNull) {
          return map.text;
        }
        continue;
      }

      if (val === map.value) {
        return map.text;
      }
    }

    if (isNull) {
      return 'null';
    }
    return val;
  }

  // Override the
  applyPanelTimeOverrides() {
    super.applyPanelTimeOverrides();

    if (this.panel.expandFromQueryS && this.panel.expandFromQueryS > 0) {
      let from = this.range.from.subtract(this.panel.expandFromQueryS, 's');
      this.range.from = from;
      this.range.raw.from = from;
    }
  }

  onDataReceived(dataList) {
    $(this.canvas).css('cursor', 'pointer');

    //    console.log('GOT', dataList);

    let data = [];
    _.forEach(dataList, metric => {
      if ('table' === metric.type) {
        if ('time' !== metric.columns[0].type) {
          throw new Error('Expected a time column from the table format');
        }
        // TODO???
      } else {
        // TODO???
      }
    });
    this.data = data;

    this.onRender();

    //console.log( 'data', dataList, this.data);
  }

  onConfigChanged(update = false) {
    //console.log( "Config changed...");
    this.isTimeline = this.panel.display === 'timeline';
    this.isStacked = this.panel.display === 'stacked';

    this.formatter = null;
    if (this.panel.units && 'none' !== this.panel.units) {
      this.formatter = kbn.valueFormats[this.panel.units];
    }

    if (update) {
      this.refresh();
    } else {
      this.render();
    }
  }

  //------------------
  // Mouse Events
  //------------------

  showTooltip(evt, point, isExternal) {
    let from = point.start;
    let to = point.start + point.ms;
    let time = point.ms;
    let val = point.val;

    if (this.mouse.down != null) {
      from = Math.min(this.mouse.down.ts, this.mouse.position.ts);
      to = Math.max(this.mouse.down.ts, this.mouse.position.ts);
      time = to - from;
      val = 'Zoom To:';
    }

    let body = '<div class="graph-tooltip-time">' + val + '</div>';

    body += '<center>';
    body += this.dashboard.formatDate(moment(from)) + '<br/>';
    body += 'to<br/>';
    body += this.dashboard.formatDate(moment(to)) + '<br/><br/>';
    body += moment.duration(time).humanize() + '<br/>';
    body += '</center>';

    let pageX = 0;
    let pageY = 0;
    if (isExternal) {
      let rect = this.canvas.getBoundingClientRect();
      pageY = rect.top + evt.pos.panelRelY * rect.height;
      if (pageY < 0 || pageY > $(window).innerHeight()) {
        // Skip Hidden tooltip
        this.$tooltip.detach();
        return;
      }
      pageY += $(window).scrollTop();

      let elapsed = this.range.to - this.range.from;
      let pX = (evt.pos.x - this.range.from) / elapsed;
      pageX = rect.left + pX * rect.width;
    } else {
      pageX = evt.evt.pageX;
      pageY = evt.evt.pageY;
    }

    this.$tooltip.html(body).place_tt(pageX + 20, pageY + 5);
  }

  onGraphHover(evt, showTT, isExternal) {
    this.externalPT = false;
    if (this.data && this.data.length) {
      let hover = null;
      let j = Math.floor(this.mouse.position.y / this.panel.rowHeight);
      if (j < 0) {
        j = 0;
      }
      if (j >= this.data.length) {
        j = this.data.length - 1;
      }

      if (this.isTimeline) {
        hover = this.data[j].changes[0];
        for (let i = 0; i < this.data[j].changes.length; i++) {
          if (this.data[j].changes[i].start > this.mouse.position.ts) {
            break;
          }
          hover = this.data[j].changes[i];
        }
        this.hoverPoint = hover;

        if (showTT) {
          this.externalPT = isExternal;
          this.showTooltip(evt, hover, isExternal);
        }
        this.onRender(); // refresh the view
      } else if (!isExternal) {
        if (this.isStacked) {
          hover = this.data[j].legendInfo[0];
          for (let i = 0; i < this.data[j].legendInfo.length; i++) {
            if (this.data[j].legendInfo[i].x > this.mouse.position.x) {
              break;
            }
            hover = this.data[j].legendInfo[i];
          }
          this.hoverPoint = hover;
          this.onRender(); // refresh the view

          if (showTT) {
            this.externalPT = isExternal;
          }
        }
      }
    } else {
      this.$tooltip.detach(); // make sure it is hidden
    }
  }

  onMouseClicked(where) {
    let pt = this.hoverPoint;
    if (pt && pt.start) {
      let range = {from: moment.utc(pt.start), to: moment.utc(pt.start + pt.ms)};
      this.timeSrv.setTime(range);
      this.clear();
    }
  }

  onMouseSelectedRange(range) {
    this.timeSrv.setTime(range);
    this.clear();
  }

  clear() {
    this.mouse.position = null;
    this.mouse.down = null;
    this.hoverPoint = null;
    $(this.canvas).css('cursor', 'wait');
    appEvents.emit('graph-hover-clear');
    this.render();
  }

  _updateRenderDimensions() {
    this._renderDimensions = {};

    let rect = (this._renderDimensions.rect = this.wrap.getBoundingClientRect());
    let rows = (this._renderDimensions.rows = this.data.length);
    let rowHeight = (this._renderDimensions.rowHeight = this.panel.rowHeight);
    let height = (this._renderDimensions.height = rowHeight * rows);
    let width = (this._renderDimensions.width = rect.width);
    let rectHeight = (this._renderDimensions.rectHeight = rowHeight);

    let top = 0;
    let elapsed = this.range.to - this.range.from;

    this._renderDimensions.matrix = [];
    _.forEach(this.data, metric => {
      let positions = [];

      if (this.isTimeline) {
        let lastBS = 0;
        let point = metric.changes[0];
        for (let i = 0; i < metric.changes.length; i++) {
          point = metric.changes[i];
          if (point.start <= this.range.to) {
            let xt = Math.max(point.start - this.range.from, 0);
            let x = xt / elapsed * width;
            positions.push(x);
          }
        }
      }

      if (this.isStacked) {
        let point = null;
        let start = this.range.from;
        for (let i = 0; i < metric.legendInfo.length; i++) {
          point = metric.legendInfo[i];
          let xt = Math.max(start - this.range.from, 0);
          let x = xt / elapsed * width;
          positions.push(x);
          start += point.ms;
        }
      }

      this._renderDimensions.matrix.push({
        y: top,
        positions: positions,
      });

      top += rowHeight;
    });
  }

  _updateSelectionMatrix() {
    let selectionPredicates = {
      all: function() {
        return true;
      },
      crosshairHover: function(i, j) {
        if (j + 1 === this.data[i].changes.length) {
          return this.data[i].changes[j].start <= this.mouse.position.ts;
        }
        return (
          this.data[i].changes[j].start <= this.mouse.position.ts &&
          this.mouse.position.ts < this.data[i].changes[j + 1].start
        );
      },
      mouseX: function(i, j) {
        let row = this._renderDimensions.matrix[i];
        if (j + 1 === row.positions.length) {
          return row.positions[j] <= this.mouse.position.x;
        }
        return (
          row.positions[j] <= this.mouse.position.x &&
          this.mouse.position.x < row.positions[j + 1]
        );
      },
      metric: function(i) {
        return this.data[i] === this._selectedMetric;
      },
      legendItem: function(i, j) {
        if (this.data[i] !== this._selectedMetric) {
          return false;
        }
        return this._selectedLegendItem.val === this._getVal(i, j);
      },
    };

    function getPredicate() {
      if (this._selectedLegendItem !== undefined) {
        return 'legendItem';
      }
      if (this._selectedMetric !== undefined) {
        return 'metric';
      }
      if (this.mouse.down !== null) {
        return 'all';
      }
      if (this.panel.highlightOnMouseover && this.mouse.position != null) {
        if (this.isTimeline) {
          return 'crosshairHover';
        }
        if (this.isStacked) {
          return 'mouseX';
        }
      }
      return 'all';
    }

    let pn = getPredicate.bind(this)();
    let predicate = selectionPredicates[pn].bind(this);
    this._selectionMatrix = [];
    for (let i = 0; i < this._renderDimensions.matrix.length; i++) {
      let rs = [];
      let r = this._renderDimensions.matrix[i];
      for (let j = 0; j < r.positions.length; j++) {
        rs.push(predicate(i, j));
      }
      this._selectionMatrix.push(rs);
    }
  }

  _updateCanvasSize() {
    this.canvas.width = this._renderDimensions.width * this._devicePixelRatio;
    this.canvas.height = this._renderDimensions.height * this._devicePixelRatio;

    $(this.canvas).css('width', this._renderDimensions.width + 'px');
    $(this.canvas).css('height', this._renderDimensions.height + 'px');

    this.context.scale(this._devicePixelRatio, this._devicePixelRatio);
  }

  _renderCrosshair() {
    if (this.mouse.down != null) {
      return;
    }
    if (this.mouse.position === null) {
      return;
    }
    if (!this.isTimeline) {
      return;
    }

    let ctx = this.context;
    let rows = this.data.length;
    let rowHeight = this.panel.rowHeight;
    let height = this._renderDimensions.height;

    ctx.beginPath();
    ctx.moveTo(this.mouse.position.x, 0);
    ctx.lineTo(this.mouse.position.x, height);
    ctx.strokeStyle = this.panel.crosshairColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw a Circle around the point if showing a tooltip
    if (this.externalPT && rows > 1) {
      ctx.beginPath();
      ctx.arc(this.mouse.position.x, this.mouse.position.y, 3, 0, 2 * Math.PI, false);
      ctx.fillStyle = this.panel.crosshairColor;
      ctx.fill();
      ctx.lineWidth = 1;
    }
  }
}

export {JoyPanelCtrl as PanelCtrl};
