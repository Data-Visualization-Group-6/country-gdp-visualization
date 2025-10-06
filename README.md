# Voronoi Treemap Visualization for Country GDP

The visualization is hosted via GitHub Pages: https://data-visualization-group-6.github.io/country-gdp-visualization/

## Description

This visualization showcases the data from countries across the globe, such as GDP, inflation rate, unemployment rate, and etc., within each node in the treemap. The area of each node is determined by the country's GDP value (larger nodes signify higher GDP values).

You may hover over each node for additional info.

### Quick Guide

To access the visualization, either go [here](https://data-visualization-group-6.github.io/country-gdp-visualization/) or clone this repository and run it locally. (details shown in the next section.)

Here is a short guide on how to navigate the visualization:
- The slider on the top left determines which year you are looking at. From left to right, you can choose which year to look at (from 2000 to 2022).
- The display mode lets you switch between two views, either by country name or by GDP makeup.
  - The 'name' (default) view simply lets you see the data sorted by individual countries.
  - The 'GDP makeup' view lets you see the subregions divided by the GDP% of different sectors within a country.
- The 'employment opacity' toggle allows you to view unemployment rate as the change in opacity of each country's node. More transparent (or lighter) colors signify a higher unemployment rate.
- There is a box that lets you filter through specific continents and countries that you wish to see.

## Rough Installation Guide
To run the visualization locally, first ensure you have Node.js installed.
1. Clone the repository and `cd` into it.
2. Run `npm install` to obtain all related packages.
3. `npm run start` to start the visualization
