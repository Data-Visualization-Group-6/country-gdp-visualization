/* 

Voronoi treemap algorithm inspiration and explanation on parent/child node structures
https://github.com/Kcnarf/d3-voronoi-treemap?tab=readme-ov-file

*/

import React, { useState, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { voronoiTreemap } from "d3-voronoi-treemap";
import Papa from "papaparse";

const TOP_9 = 9;

// Load csv which lives on site's root
const CSV_PATH =
  new URLSearchParams(window.location.search).get('src') ||
  `${process.env.PUBLIC_URL}/countries.csv`;

const continentColors = {
  Africa: "#7f5539",
  Asia: "#0015ff",
  Europe: "#ff7d00",
  "North America": "#073b4c",
  "South America": "#8ac926",
  Oceania: "#ff006d",
};

const gdpComponentColors = {
  "Agriculture (% GDP)": "#228B22",
  "Industry (% GDP)": "#4169E1",
  "Service (% GDP)": "#FFD700",
  "Export (% GDP)": "#8B008B",
  "Import (% GDP)": "#FF4500",
  Other: "#E0E0E0",
};

function getInflationColor(inflationRate) {
  if (inflationRate === null || inflationRate === undefined || isNaN(inflationRate)) return "#FFFFFF";
  if (inflationRate < 0) {
    const intensity = Math.min(Math.abs(inflationRate) * 20, 255);
    return `rgb(255, ${255 - intensity}, ${255 - intensity})`; // red-ish for deflation magnitude
  } else {
    const intensity = Math.min(inflationRate * 20, 255);
    return `rgb(${255 - intensity}, 255, ${255 - intensity})`; // green-ish for inflation magnitude
  }
}

function getOpacity(unemployment) {
  if (unemployment === null) return 1;
  
  const BASE = 4;
  const MAX = 15;
  const BASE_OPACITY = 1;
  const MAX_OPACITY = 0.3;

  const unemployment_ = Number(unemployment);
  const opacity = Math.max(BASE, Math.min (MAX, unemployment_));
  return BASE_OPACITY + ((opacity - BASE) / (MAX - BASE)) * (MAX_OPACITY - BASE_OPACITY);
}

function calcMakeup(record) {
  const parts = {
    "Agriculture (% GDP)": Number(record["Agriculture (% GDP)"]) || 0,
    "Industry (% GDP)": Number(record["Industry (% GDP)"]) || 0,
    "Service (% GDP)": Number(record["Service (% GDP)"]) || 0,
    "Export (% GDP)": Number(record["Export (% GDP)"]) || 0,
    "Import (% GDP)": Number(record["Import (% GDP)"]) || 0,
  };
  const sum = Object.values(parts).reduce((s, v) => s + v, 0);
  if (sum <= 0) return {};
  // Normalize to percentages
  for (const key in parts) {
    parts[key] = (parts[key] / sum) * 100;
  }
  return parts;

}

function numberConversion(value) {
  if (value == null || isNaN(value)) return "N/A";
  return (value / 1e12).toFixed(2) + "T";
}

function buildHierarchy(rows, year, selectedCountries, selectedContinents) {
  let yearRows = rows.filter(
    (r) => Number(r.Year) === Number(year) && r["Country Name"] && Number(r.GDP) > 0
  );

  // Respect UI filters
  if (selectedCountries.size > 0) {
    yearRows = yearRows.filter(r => selectedCountries.has(r["Country Name"]));
  }
  if (selectedContinents.size > 0) {
    yearRows = yearRows.filter(r => selectedContinents.has(r["Continent Name"]));
  }

  // group by continent
  const byCont = d3.group(yearRows, (d) => d["Continent Name"] || "Unknown");

  const continentNodes = [];
  for (const [cont, items] of byCont.entries()) {
    // top 9 per continent
    const top = items
      .slice()
      .sort((a, b) => Number(b.GDP) - Number(a.GDP))
      .slice(0, TOP_9);

    // build country nodes
    const countries = top.map((r) => {
      const base = {
        name: r["Country Name"],
        continent: cont || "Unknown",
        unemployment: Number(r.Unemployment) ?? null,
        inflation: Number(r["Inflation Rate"]).toFixed(0),
        service: Number(r["Service (% GDP)"]).toFixed(0),
        import: Number(r["Import (% GDP)"]).toFixed(0),
        export: Number(r["Export (% GDP)"]).toFixed(0),
        agriculture: Number(r["Agriculture (% GDP)"]).toFixed(0),
        industry: Number(r["Industry (% GDP)"]).toFixed(0),
        gpdpercapita: Number(r["GDP Per Capita"]).toFixed(2),
        education: Number(r["Education Expenditure"]).toFixed(0),
        health: Number(r["Health Expenditure"]).toFixed(0)
      };

      // optional GDP makeup children (sum equals GDP)
      const makeup = calcMakeup(r);
      const entries = Object.entries(makeup).filter(([, pct]) => pct > 0.0001);

      if (entries.length > 0 && !base.name.startsWith("Others (")) {
        return {
          ...base,
          children: entries.map(([label, pct]) => ({
            name: label,
            value: (Number(r.GDP) || 0) * (pct / 100),
          })),
        };
      } else {
        return {
          ...base,
          value: Number(r.GDP) || 0,
        };
      }
    });

    // continent node (no direct value; its size derives from its children)
    continentNodes.push({
      name: cont,
      continent: cont,
      children: countries
    });
  }

  return { name: "World", children: continentNodes };
}


const VoronoiTreemap = () => {
  const [rows, setRows] = useState([]);
  const [yearBounds, setYearBounds] = useState([2000, 2022]); // 2000 to 2022 years
  const [selectedYear, setSelectedYear] = useState(2000);
  const [displayMode, setDisplayMode] = useState("name"); // 'name' or 'makeup'
  const [selectedCountries, setSelectedCountries] = useState(new Set());
  const [selectedContinents, setSelectedContinents] = useState(new Set());
  const [expandedContinents, setExpandedContinents] = useState(new Set());
  const [useOpacity, setUseOpacity] = useState(true);


  const wrapperRef = useRef(null);
  const svgRef = useRef(null);
  const [dims, setDims] = useState({ w: 1000, h: 700 });
  const toolTipRef = useRef(null); // ref for toolTip object

  // Resize observer for responsive SVG
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const w = Math.max(640, Math.floor(entries[0].contentRect.width));
      setDims({ w, h: Math.max(500, Math.round(w * 0.62)) });
    });

    //tooltip creation when page is first rendered
    toolTipRef.current = d3.select("body")
      .append("div")
      .attr("class","tooltip")
      .style("position", "absolute")
      .style("opacity",0)
      .style("pointer-events","none")
      .style("background","rgba(0,0,0,0.8)")
      .style("color", "#fff")
      .style("padding", "6px 10px")
      .style("border-radius", "4px")
      .style("font-size", "12px");       

    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
  function loadCSV() {
    Papa.parse(CSV_PATH, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const parsedData = data.map((r) => ({
          ...r,
          Year: Number(r.Year),
          GDP: Number(r.GDP),
          Unemployment: r.Unemployment !== "" ? Number(r.Unemployment) : null,
          "Inflation Rate": r["Inflation Rate"] !== "" ? Number(r["Inflation Rate"]) : null,
        }));
        setRows(parsedData);

        const years = parsedData.map((r) => r.Year).filter((y) => !isNaN(y));
        if (years.length) {
          const min = Math.min(...years);
          const max = Math.max(...years);
          setYearBounds([min, max]);
          setSelectedYear(min);
        }
      },
      error: (err) => {
        console.error("CSV load error:", err);
      },
    });
  }
  loadCSV();
  }, []); // runs once on mount

  // Get hierarchical structure of continents and their countries
  const continentCountryMap = useMemo(() => {
    if (!rows.length) return {};
    const map = {};
    rows.forEach(row => {
      const continent = row["Continent Name"];
      const country = row["Country Name"];
      if (continent && country) {
        if (!map[continent]) {
          map[continent] = new Set();
        }
        map[continent].add(country);
      }
    });
    // Convert Sets to sorted arrays
    const sortedMap = {};
    Object.keys(map).sort().forEach(continent => {
      sortedMap[continent] = [...map[continent]].sort();
    });
    return sortedMap;
  }, [rows]);

  const availableContinents = useMemo(() => {
    return Object.keys(continentCountryMap).sort();
  }, [continentCountryMap]);

  // Get top 5 countries based on current selections
  const top5Countries = useMemo(() => {
    if (!rows.length) return [];
    
    let filteredRows = rows.filter(
      (r) => Number(r.Year) === Number(selectedYear) && r["Country Name"] && Number(r.GDP) > 0
    );

    // Apply same filtering logic as buildHierarchy
    if (selectedCountries.size > 0) {
      filteredRows = filteredRows.filter(r => selectedCountries.has(r["Country Name"]));
    }
    if (selectedContinents.size > 0) {
      filteredRows = filteredRows.filter(r => selectedContinents.has(r["Continent Name"]));
    }

    // Sort by GDP and take top 5
    return filteredRows
      .sort((a, b) => Number(b.GDP) - Number(a.GDP))
      .slice(0, 5)
      .map(row => ({
        name: row["Country Name"],
        continent: row["Continent Name"],
        gdp: Number(row.GDP)
      }));
  }, [rows, selectedYear, selectedCountries, selectedContinents]);

  const hierarchyData = useMemo(() => {
    if (!rows.length) return null;
    return buildHierarchy(rows, selectedYear, selectedCountries, selectedContinents);
  }, [rows, selectedYear, selectedCountries, selectedContinents]);

  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode || !hierarchyData) return;

    const svgEl = d3.select(svgNode);
    svgEl.selectAll("*").remove();

    const { w, h } = dims;
    const svg = svgEl.attr("viewBox", `0 0 ${w} ${h}`);

    function seededRandom(seed) {
      let s = seed;
      return function () {
        s = Math.sin(s) * 10000;
        return s - Math.floor(s);
      };
    }

    const root = d3
      .hierarchy(hierarchyData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // https://github.com/d3/d3-hierarchy?tab=readme-ov-file
    // allowed for sectioning of polygons
    const vt = voronoiTreemap()
      .clip([
        [0, 0],
        [0, h],
        [w, h],
        [w, 0],
      ])
      // ensures rendering completes and smaller nodes do not get lost
      .convergenceRatio(0.015)
      .maxIterationCount(80)
      .minWeightRatio(0.002)
      .prng(seededRandom(12345));

    vt(root);
    
    const continents = root.children || [];
    const gContinents = svg.append("g").attr("class", "continents");
    
    continents.forEach((contNode) => {
      const contPoly = contNode.polygon;
      if (!contPoly) return;

      const gCont = gContinents
        .append("g")
        .attr(
          "class",
          `continent ${contNode.data.name.replace(/\s+/g, "-").toLowerCase()}`
        );

      gCont
        .append("path")
        .attr("d", `M${contPoly.join("L")}Z`)
        .attr("fill", "none")
        .attr("stroke", "rgba(0,0,0,0.08)")
        .attr("stroke-width", 2);

      (contNode.children || []).forEach((node) => {
        const polygon = node.polygon;
        if (!polygon) return;

        const country = node.data;
        const borderColor = getInflationColor(country.inflation);
        const area = Math.abs(d3.polygonArea(polygon));
        const centroid = d3.polygonCentroid(polygon);

        const g = gCont.append("g").attr("class", "country");

        if (displayMode === "name" || !(node.children && node.children.length)) {
          g.append("path")
            .attr("d", `M${polygon.join("L")}Z`)
            .attr("fill", continentColors[country.continent] || "#ccc")
            .attr("fill-opacity", useOpacity ? getOpacity(country.unemployment) : 1)
            .attr("stroke", borderColor)
            .attr("stroke-width", 2)
            .on("mouseover", (event) => {
              toolTipRef.current
                .html(
                  `<strong>${country.name} - ${country.continent ?? "Unknown"}</strong><br/>
                  GDP: $${numberConversion(node.value)}<br/>
                  GDP Per Capita: $${country.gpdpercapita ?? "N/A"}<br/>
                  Agriculture(% GDP): ${country.agriculture ?? "N/A"}%<br/>
                  Service(% GDP): ${country.service ?? "N/A"}%<br/>
                  Industry(% GDP): ${country.industry ?? "N/A"}%<br/>
                  Inflation Rate: ${country.inflation ?? "N/A"}%<br/>
                  Unemployment Rate: ${country.unemployment ?? "N/A"}%<br/>`
                )
                .style("opacity", 1);
            })
            .on("mousemove", (event) => {
              toolTipRef.current
                .style("left", event.pageX + 10 + "px")
                .style("top", event.pageY + 10 + "px");
            })
            .on("mouseleave", () => {
              toolTipRef.current.style("opacity", 0);
            });
        } else {
          (node.children || []).forEach((compNode) => {
            const compPoly = compNode.polygon;
            if (!compPoly) return;

            const compGroup = g.append("g");

            compGroup
              .append("path")
              .attr("d", `M${compPoly.join("L")}Z`)
              .attr("fill", gdpComponentColors[compNode.data.name] || "#ddd")
              .attr(
                "fill-opacity",
                useOpacity ? getOpacity(country.unemployment) : 1
              )
              .attr("stroke", "rgba(0,0,0,0.05)")
              .attr("stroke-width", 1);

            compGroup
              .append("path")
              .attr("d", `M${compPoly.join("L")}Z`)
              .attr("fill", "none")
              .attr("stroke", "white")
              .attr("stroke-width", 4)
              .attr("opacity", 0)
              .attr("pointer-events", "none");

            compGroup
              .on("mouseover", () => {
                const pct = ((compNode.value / node.value) * 100).toFixed(1);
                compGroup.select("path:nth-child(2)").attr("opacity", 1);
                toolTipRef.current
                  .html(
                    `<strong>${country.name} - ${compNode.data.name}</strong><br/>
                    Value: $${numberConversion(compNode.value)}<br/>
                    Percentage of Total GDP: ${pct}%`
                  )
                  .style("opacity", 1);
              })
              .on("mousemove", (event) => {
                toolTipRef.current
                  .style("left", event.pageX + 10 + "px")
                  .style("top", event.pageY + 10 + "px");
              })
              .on("mouseleave", () => {
                compGroup.select("path:nth-child(2)").attr("opacity", 0);
                toolTipRef.current.style("opacity", 0);
              });
          });

          g.append("path")
            .attr("d", `M${polygon.join("L")}Z`)
            .attr("fill", "none")
            .attr("stroke", borderColor)
            .attr("stroke-width", 2);
        }

        if (area > 1200) {
          g.append("text")
            .attr("x", centroid[0])
            .attr("y", centroid[1])
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("fill", displayMode === "name" ? "#fff" : "#111")
            .style("font-weight", "700")
            .style("font-size", `${Math.max(10, Math.sqrt(area) / 18)}px`)
            .text(country.name);

          if (area > 4200) {
            g.append("text")
              .attr("x", centroid[0])
              .attr("y", centroid[1] + Math.sqrt(area) / 18)
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "hanging")
              .attr("fill", displayMode === "name" ? "#fff" : "#333")
              .style("font-size", `${Math.max(9, Math.sqrt(area) / 24)}px`)
              .text(`$${((node.value || 0) / 1e12).toFixed(2)}T`);
          }
        }
      });
    });
  }, [hierarchyData, dims, displayMode, selectedYear, useOpacity]);


  return (

    <div className="w-full min-h-screen bg-white">
      <div className ="body">
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6 text-center">GDP Visualization</h1>

        {/* Controls */}
        <div className="bg-gray-100 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            {/* Time slider for different years */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Year: {selectedYear}
              </label>
              <input
                type="range"
                min={yearBounds[0]}
                max={yearBounds[1]}
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full"
                disabled={!rows.length}
              />
            </div>

            {/* Display either gdp makeup or by country name and size = gdp */}
            <div>
              <label className="block text-sm font-medium mb-2">Display Mode</label>
              <select
                value={displayMode}
                onChange={(e) => setDisplayMode(e.target.value)}
                className="w-full px-4 py-2 border rounded"
                disabled={!rows.length}
              >
                <option value="name">Country Name (continent color)</option>
                <option value="makeup">GDP Makeup (subdivided)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="opacityToggle"
                type="checkbox"
                checked={useOpacity}
                onChange={(e) => setUseOpacity(e.target.checked)}
                className="h-4 w-4"
                disabled={!rows.length}
              />
              <label htmlFor="opacityToggle" className="text-sm">
                Use employment opacity
              </label>
            </div>
          </div>



          {/* Select country and continents */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-medium">
                  Countries & Continents ({selectedCountries.size} countries, {selectedContinents.size} continents selected)
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const allCountries = Object.values(continentCountryMap).flat();
                      setSelectedCountries(new Set(allCountries));
                      setSelectedContinents(new Set(availableContinents));
                    }}
                    className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => {
                      setSelectedCountries(new Set());
                      setSelectedContinents(new Set());
                    }}
                    className="text-xs bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600"
                  >
                    Clear All
                  </button>
                </div>
              </div>
              
              <div className="max-h-60 overflow-y-auto border rounded bg-white">
                {availableContinents.map(continent => {
                  const countries = continentCountryMap[continent] || [];
                  const isExpanded = expandedContinents.has(continent);
                  const selectedCountriesInContinent = countries.filter(country => selectedCountries.has(country));
                  const allCountriesInContinentSelected = countries.length > 0 && selectedCountriesInContinent.length === countries.length;
                  const continentSelected = selectedContinents.has(continent) || allCountriesInContinentSelected;
                  
                  return (
                    <div key={continent} className="border-b border-gray-100 last:border-b-0">
                      {/* Continent Header */}
                      <div className="flex items-center p-3 bg-gray-50 hover:bg-gray-100">
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedContinents);
                            if (isExpanded) {
                              newExpanded.delete(continent);
                            } else {
                              newExpanded.add(continent);
                            }
                            setExpandedContinents(newExpanded);
                          }}
                          className="mr-2 text-gray-600 hover:text-gray-800"
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                        <input
                          type="checkbox"
                          checked={continentSelected}
                          onChange={(e) => {
                            const newSelectedContinents = new Set(selectedContinents);
                            const newSelectedCountries = new Set(selectedCountries);
                            
                            if (e.target.checked) {
                              newSelectedContinents.add(continent);
                              // Select all countries in this continent
                              countries.forEach(country => newSelectedCountries.add(country));
                            } else {
                              newSelectedContinents.delete(continent);
                              // Deselect all countries in this continent
                              countries.forEach(country => newSelectedCountries.delete(country));
                            }
                            
                            setSelectedContinents(newSelectedContinents);
                            setSelectedCountries(newSelectedCountries);
                          }}
                          className="mr-3"
                        />
                        <span className="font-medium text-sm flex-1">{continent}</span>
                        <span className="text-xs text-gray-500">
                          {selectedCountriesInContinent.length}/{countries.length} countries
                        </span>
                      </div>
                      
                      {/* Country list */}
                      {isExpanded && (
                        <div className="bg-white">
                          {countries.map(country => (
                            <label key={country} className="flex items-center p-2 pl-8 hover:bg-gray-50 cursor-pointer border-l-2 border-gray-100">
                              <input
                                type="checkbox"
                                checked={selectedCountries.has(country)}
                                onChange={(e) => {
                                  const newSelectedCountries = new Set(selectedCountries);
                                  const newSelectedContinents = new Set(selectedContinents);
                                  
                                  if (e.target.checked) {
                                    newSelectedCountries.add(country);
                                    // Check if all countries in this continent are now selected
                                    const updatedSelectedInContinent = [...selectedCountriesInContinent, country];
                                    if (updatedSelectedInContinent.length === countries.length) {
                                      newSelectedContinents.add(continent);
                                    }
                                  } else {
                                    newSelectedCountries.delete(country);
                                    // If deselecting a country, also deselect the continent
                                    newSelectedContinents.delete(continent);
                                  }
                                  
                                  setSelectedCountries(newSelectedCountries);
                                  setSelectedContinents(newSelectedContinents);
                                }}
                                className="mr-3"
                              />
                              <span className="text-sm">{country}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Load the treemap chart */}
        <div ref={wrapperRef} className="w-full bg-white">
          <svg ref={svgRef} className="w-full h-auto block" />
        </div>

        {/* Legend */}
        <div className="bg-gray-100 rounded-lg p-4 mb-6">
          <h3 className="font-bold mb-3">Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><strong>Size:</strong> GDP (area)</div>
            <div><strong>Opacity:</strong> {useOpacity ? "Employment rate" : "Solid Color"}</div>
            <div><strong>Border:</strong> Inflation (Green=+, Red=-, White=NULL)</div>
            <div><strong>Color:</strong> {displayMode === "name" ? "Continent" : "GDP Components"}</div>
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-sm">
            {displayMode === "name"
              ? Object.entries(continentColors).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 rounded" style={{ background: v }} />
                    {k}
                  </div>
                ))
              : Object.entries(gdpComponentColors).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="inline-block w-4 h-4 rounded" style={{ background: v }} />
                    {k}
                  </div>
                ))}
          </div>
        </div>


        {/* Top 5 Countries Section */}
        {rows.length > 0 && top5Countries.length > 0 && (
          <div className="bg-gray-100 rounded-lg p-4 mb-6">
            <h3 className="font-bold mb-3">Top 5 Countries by GDP ({selectedYear})</h3>
            <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Continent</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">GDP</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {top5Countries.map((country, index) => (
                    <tr key={country.name} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="bg-blue-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{country.name}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{country.continent}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="text-sm font-bold text-gray-900">
                          {(() => {
                            const trillions = country.gdp / 1e12;
                            return `$${trillions >= 0.1 ? trillions.toFixed(2) + "T" : (country.gdp / 1e9).toFixed(0) + "B"}`;
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {top5Countries.length < 5 && (
              <div className="text-center text-sm text-gray-500 mt-3">
                Showing {top5Countries.length} countries (filtered by your selections)
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>

      

  );
};

export default VoronoiTreemap;
