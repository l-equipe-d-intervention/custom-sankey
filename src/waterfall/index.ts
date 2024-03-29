import * as d3 from 'd3'
import { handleErrors } from '../utils'
// import colors from '../colors.json'
import { Bar, Looker, Waterfall } from '../types'
import colors from '../colors.csv'
import { computeData, getTooltipHtml, humanize, textFormatter } from './utils'

// Global values provided via the API
declare const looker: Looker

const vis: Waterfall = {
  id: 'custom_waterfall', // id/label not required, but nice for testing and keeping manifests in sync
  label: 'mROI Waterfall',
  options: {
    color_range: {
      type: 'array',
      label: 'Color Range',
      display: 'colors',
      default: [
        '#dd3333',
        '#80ce5d',
        '#f78131',
        '#369dc1',
        '#c572d3',
        '#36c1b3',
        '#b57052',
        '#ed69af',
      ],
    },
    value_labels: {
      type: 'boolean',
      label: 'Value Labels',
      default: true,
    },
    label_type: {
      default: 'value',
      display: 'select',
      label: 'Label Type',
      type: 'string',
      values: [
        { 'Value': 'value' },
        { 'Value (percentage)': 'value_percentage' },
      ],
    },
    show_gridlines: {
      type: 'boolean',
      label: 'Gridlines',
      default: true,
    },
    show_lines_between_blocks: {
      type: 'boolean',
      label: 'Lines between blocks',
      default: true,
    },
    sum_for_baseline: {
      type: 'boolean',
      label: 'Compute SUM for baseline measure',
      default: true,
    },
  },
  // Set up the initial state of the visualization
  create(element) {
    element.innerHTML = `
      <style>
      .bar.total rect {
        fill: steelblue;
      }
      
      .bar line.connector {
        stroke: lightgrey;
        stroke-dasharray: 3;
        stroke-width: 1px;
      }
      
      .bar text {
        fill: #333333;
        font: 12px sans-serif;
        font-weight: bold;
        text-anchor: middle;
      }
      
      .axis text {
        font-family: Roboto, "Noto Sans", sans-serif;
        font-size: 12px;
        color: #3a4245;
      }
      
      .axis path,
      .axis line {
        fill: none;
        stroke: #000;
        shape-rendering: crispEdges;
      }
      
      .axis.x text {
        /*transform: rotateZ(-45deg);*/
        /*transform-origin: 100% 12px;*/
        /*z-index: 9999;*/
      }
      
      text.axis-name {
        font-family: Roboto, "Noto Sans", sans-serif;
        font-size: 12px;
      }
      
      .tooltip {
        font-family: "Roboto", "Noto Sans", sans-serif;
        font-size: 0.75rem;
        position: absolute;
        z-index: 10;
        background-color: #333;
        border: none;
        border-radius: 5px;
        padding: 12px;
        text-align: left;
        color: white;
      }
      
      .tooltip .title {
        font-weight: 800;
      }
      </style>
    `
    this.svg = d3.select(element).append('svg')
    this.tooltip = d3.select(element).append('div')
      .attr('class', 'tooltip')
      .style('opacity', 0)
      .style('visibility', 'hidden')
      .text('a simple tooltip')
  },
  // Render in response to the data or settings changing
  updateAsync(data, element, config, queryResponse, _details, doneRendering) {
    console.log('data', data)
    console.log('config', config)
    console.log('fields', queryResponse.fields)
    const { dimensions } = config.query_fields
    const max_measures = dimensions.length > 0 ? 2 : undefined

    if (
      !handleErrors(this, queryResponse, {
        min_pivots: 0,
        max_pivots: 0,
        min_dimensions: 0,
        min_measures: 1,
        max_measures,
      })
    ) {
      return
    }

    // UTILS
    const d3ColorFunction = d3
      .scaleOrdinal()
      .range(config.color_range || vis.options.color_range.default)

    const getColorForNode = (node: { dimensionName: string; key: string }) => {
      if (node.dimensionName && node.key) {
        const color = colors.find(
          (color: { dimensionName: string; dimensionValue: string }) => {
            return (
              node.dimensionName.endsWith(color.dimensionName) &&
              color.dimensionValue === node.key
            )
          },
        )
        if (color) {
          return color.colorCode
        }
      }
      return d3ColorFunction(`${node.dimensionName}.${node.key}`)
    }

    // DATA PROCESSING
    const { dimension_like, measure_like } = queryResponse.fields
    const hasBaseMeasure = measure_like.length === 2
    const [baseDimension] = dimension_like
    const [baseMeasure, measure] = hasBaseMeasure ? measure_like : [undefined, measure_like[0]]
    console.log('base dimension', baseDimension)
    console.log('base measure', baseMeasure)
    console.log('measure', measure)
    const computedData = computeData(data, queryResponse, config)
    const min = d3.min(computedData, d => d.start || 0) || 0
    const max = d3.max(computedData, d => d.end || d.value) || 0

    // SIZES
    const margin = { top: 20, right: 30, bottom: 20, left: 40 }
    const width = element.clientWidth - margin.left - margin.right
    const height = element.clientHeight - margin.top - margin.bottom
    const padding = 0.3

    // X AXIS
    const xScale = d3.scaleBand()
      .range([0, width])
      .domain(computedData.map(d => d.name))
      .padding(padding)

    const xAxis = d3.axisBottom(xScale)
      .tickSizeOuter(0)
      .tickSizeInner(0)

    // Y AXIS
    const yScale = d3.scaleLinear()
      .range([height, 0])
      .domain([min, max]).interpolate(d3.interpolateRound)

    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat(d => d === 0 ? '' : humanize(Number(d), 0))
      .tickSizeOuter(0)
      .tickSizeInner(0)

    // CONTAINER
    const chart = this.svg
      .html('')
      .attr('width', element.clientWidth)
      .attr('height', element.clientHeight)
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .append('g')
      .attr('transform', `translate(${margin.left} ,${margin.top})`)

    // ADDING X AXIS
    const xAxisGroup = chart.append('g')
      .attr('class', 'x axis')
      .attr('transform', `translate(0, ${yScale(0) + 5})`)
      .call(xAxis)
      .select('.domain')
      .attr('stroke-width', 0)

    // check for label overlaps
    xAxisGroup.selectAll('text')
      .style('text-anchor', 'end')
      .attr('dx', '-0.8em')
      .attr('dy', '-0.5em')
      .attr('transform', 'rotate(-45)')

    const xAxisHeight = xAxisGroup.node().getBBox().height

    if (xAxisHeight > margin.bottom) {
      xAxisGroup.selectAll('text')
        .style('text-anchor', 'end')
        .attr('dx', '-0.8em')
        .attr('dy', '-0.5em')
        .attr('transform', 'rotate(-45)')
    }

    // ADDING Y AXIS
    chart.append('g')
      .attr('class', 'y axis')
      .call(yAxis)
      .select('.domain')
      .attr('stroke-width', 0)

    // add Y axis name
    // this.svg.append('text')
    //   .attr('class', 'y axis-name')
    //   .attr('transform', `translate(${margin.left / 2},${height / 2}) rotate(-90)`)
    //   .style('text-anchor', 'middle')
    //   .text(measure.field_group_variant);

    // GRIDLINES
    if (config.show_gridlines) {
      chart.selectAll('line.horizontalGrid')
        .data(yScale.ticks(6))
        .join('line')
        .attr('class', 'horizontalGrid')
        .attr('x1', 10)
        .attr('x2', width)
        .attr('y1', (d: number) => yScale(d) + 0.5)
        .attr('y2', (d: number) => yScale(d) + 0.5)
        .attr('fill', 'none')
        .attr('stroke', '#E6E6E6')
        .attr('stroke-width', '1px')
        .attr('shape-rendering', 'crispEdges')
    }

    // DRAWING BARS
    const bar = chart.selectAll('.bar')
      .data(computedData)
      .join('g')
      .attr('class', 'bar')
      .style('fill', (d: Bar) => d.color || getColorForNode({ dimensionName: baseDimension.name, key: d.id }))
      .attr('transform', (d: Bar) => `translate(${xScale(d.name)},0)`)

    bar.append('rect')
      .attr('y', (d: Bar) => yScale(Math.max(d.start || 0, d.end || d.value)))
      .attr('height', (d: Bar) => Math.abs(yScale(d.start || 0) - yScale(d.end || d.value)))
      .attr('width', xScale.bandwidth())

    // LABELS
    if (config.value_labels) {
      bar.append('text')
        .attr('x', xScale.bandwidth() / 2)
        .attr('y', (d: Bar) => yScale(d.end || d.value) + 5)
        // TODO: Put label above or under if bar is too small
        .attr('dy', (d: Bar) => ((d.color == 'negative') ? '-' : '') + '.75em')
        .text((d: Bar) => textFormatter(d, config.label_type))
    }

    // TOOLTIP
    const mouseover = (event: MouseEvent, d: Bar) => {
      this.tooltip.transition()
        .duration(200)
        .style('opacity', 1)
        .style('visibility', 'visible')
      this.tooltip.html(`${getTooltipHtml(d.tooltipLabel, textFormatter(d, config.label_type))}`)
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY + 10}px`)
    }

    const mousemove = (event: MouseEvent) => {
      this.tooltip
        .style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY + 10}px`)
    }

    const mouseleave = () => {
      this.tooltip.transition()
        .duration(200)
        .style('opacity', 0)
        .style('visibility', 'hidden')
    }

    bar
      .on('mouseover', mouseover)
      .on('mousemove', mousemove)
      .on('mouseleave', mouseleave)

    // IN-BETWEEN BLOCK LINES
    if (config.show_lines_between_blocks) {
      bar.filter((d: Bar) => d.color !== 'total').append('line')
        .attr('class', 'connector')
        .attr('x1', xScale.bandwidth() + 5)
        .attr('y1', (d: Bar) => yScale(d.end || d.value))
        .attr('x2', xScale.bandwidth() / (1 - padding) - 5)
        .attr('y2', (d: Bar) => yScale(d.end || d.value))
    }

    doneRendering()
  },
}
looker.plugins.visualizations.add(vis)
