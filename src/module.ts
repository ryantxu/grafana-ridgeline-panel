///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import config from 'app/core/config';

import {CanvasPanelCtrl} from './canvas-metric';

import _ from 'lodash';
import $ from 'jquery';
import moment from 'moment';
import kbn from 'app/core/utils/kbn';

import appEvents from 'app/core/app_events';

//type XAxisTransform = "Hour" | "Day" | "Year";

export class RidgeRow {
  label: string;
  values: number[]; // Raw value
  position: number[] = null; // null if evenly spaced.  Or 0-1 % on the xaxis
  ms: number[] = null; // Optional
  ypixel: number; // the y zero line
}

export class RidgeData {
  min: number;
  max: number;
  delta: number;

  rows: RidgeRow[];

  addData(value: number, ms: number) {
    console.log('TODO, add nubmer');
  }
}

class RidgeDataForDay extends RidgeData {
  // This expects the data to be ordered oldest to newest
  static msInDay = 1000 * 60 * 60 * 24.0;

  dayOfYear: number = -1;
  timeAtStartOfDay: number = -1;

  addData(value: number, ms: number) {
    if (!value || value < 0) {
      console.error('SKIP Value', value);
      return;
    }

    const t = moment(ms);
    const doy = t.dayOfYear();

    if (!this.rows) {
      this.rows = [];
      this.min = value;
      this.max = value;
    }

    if (this.dayOfYear != doy) {
      let r = new RidgeRow();
      r.values = [];
      r.position = [];
      r.ms = [];
      r.label = t.format('YYYY-MM-DD');
      this.timeAtStartOfDay = t.startOf('day').valueOf();
      this.rows.push(r);
      this.dayOfYear = doy;
    }
    const row = this.rows[this.rows.length - 1];
    if (value > this.max) {
      this.max = value;
    }
    if (value < this.min) {
      this.min = value;
    }

    row.values.push(value);
    row.position.push((ms - this.timeAtStartOfDay) / RidgeDataForDay.msInDay);
    row.ms.push(ms);
  }
}

class RidgelinePanelCtrl extends CanvasPanelCtrl {
  static templateUrl = 'partials/module.html';
  static scrollable = true;

  defaults = {
    xtransform: 'Day',
    rowHeight: 50,
    rowHeightFactor: 2.5,
    metricNameColor: '#000000',
    valueTextColor: '#000000',
    crosshairColor: '#8F070C',
    backgroundColor: 'rgba(128,128,128,0.1)',
    lineColor: 'rgba(0,0,0,0.1)',
    units: 'short',
  };

  data: RidgeData = null;
  externalPT = false;

  hoverPoint: any = null;
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
      'public/plugins/natel-ridgeline-panel/partials/editor.options.html',
      1
    );
    this.addEditorTab(
      'Colors',
      'public/plugins/natel-ridgeline-panel/partials/editor.colors.html',
      2
    );
    this.editorTabIndex = 1;
    this.refresh();
  }

  clearTT() {
    this.$tooltip.detach();
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

    let data = new RidgeDataForDay();
    _.forEach(dataList, metric => {
      if ('table' === metric.type) {
        throw new Error('Table data not yet supported');
      } else {
        _.forEach(metric.datapoints, point => {
          data.addData(point[0], point[1]);
        });
      }
    });
    data.delta = data.max - data.min;
    this.data = data;

    this.onRender();

    //console.log( 'data', dataList, this.data);
  }

  onConfigChanged(update = false) {
    //console.log( "Config changed...");

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
    if (this.data && this.data.rows) {
      let hover = null;
      let j = Math.floor(this.mouse.position.y / this.panel.rowHeight);
      if (j < 0) {
        j = 0;
      }
      if (j >= this.data.rows.length) {
        j = this.data.rows.length - 1;
      }

      // TODO.. process hover
    } else {
      this.$tooltip.detach(); // make sure it is hidden
    }
  }

  onMouseClicked(where) {
    let pt = this.hoverPoint;
    if (pt && pt.start) {
      // let range = {from: moment.utc(pt.start), to: moment.utc(pt.start + pt.ms)};
      // this.timeSrv.setTime(range);
      // this.clear();
      console.log('TODO... click', pt);
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

  onRender() {
    if (!this.data || !this.data.rows || !this.context) {
      return;
    }

    let rect = (this._renderDimensions.rect = this.wrap.getBoundingClientRect());
    let rows = (this._renderDimensions.rows = this.data.rows.length);
    let rowHeight = (this._renderDimensions.rowHeight = this.panel.rowHeight);
    let height = (this._renderDimensions.height = rowHeight * rows);
    let width = (this._renderDimensions.width = rect.width);
    let rectHeight = (this._renderDimensions.rectHeight = rowHeight);

    let top = rowHeight;
    let elapsed = this.range.to - this.range.from;

    const ctx = this.context;
    this._updateCanvasSize();

    // Clear the background
    ctx.fillStyle = this.panel.backgroundColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.imageSmoothingEnabled = true;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.panel.lineColor;
    this._renderDimensions.matrix = [];
    _.forEach(this.data.rows, row => {
      ctx.beginPath();

      // https://github.com/epistemex/cardinal-spline-js
      for (let i = 0; i < row.values.length; i++) {
        const x = 0 + row.position[i] * width;
        const y = top - this._calculateHeight(row.values[i], row);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      ctx.fillStyle = this.panel.valueTextColor;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 10, top);

      //ctx.arc(x, y, 1, 0, 2 * Math.PI, true);

      top += rowHeight;
    });
  }

  _calculateHeight(v: number, row): number {
    const per = (v - this.data.min) / this.data.delta;
    const xxx = per * this.panel.rowHeight * this.panel.rowHeightFactor;
    //  console.log( row.label, per, this.data.min, this.data.max, this.data.delta, v, xxx );
    return xxx;
  }

  _updateCanvasSize() {
    this.canvas.width = this._renderDimensions.width * this._devicePixelRatio;
    this.canvas.height = this._renderDimensions.height * this._devicePixelRatio;

    $(this.canvas).css('width', this._renderDimensions.width + 'px');
    $(this.canvas).css('height', this._renderDimensions.height + 'px');

    this.context.scale(this._devicePixelRatio, this._devicePixelRatio);
  }
}

export {RidgelinePanelCtrl as PanelCtrl};
