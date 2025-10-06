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
  Africa: "#041035",
  Asia: "#0015ff",
  Europe: "#ff7d00",
  "North America": "#073b4c",
  "South America": "#687259",
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
  if (unemployment === null || unemployment === undefined || isNaN(unemployment)) return 0.1;
  
  const BASE = 4;
  const MAX = 15;
  const BASE_OPACITY = 0.9;
  const MAX_OPACITY = 0.1;

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
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, (v / sum) * 100]));
}
function numberConversion(number){
  if (number >= 1000000 && number <= 999999999){
    return (number/1000000).toFixed(2) + "M";
  }else if (number >= 1000000000 && number <= 999999999999){
    return (number/1000000000).toFixed(2) + "B";
  }else if (number >= 1000000000000 && number <= 999999999999999){
    return (number/1000000000000).toFixed(2) + "T";
  
} 
}

function buildHierarchy(rows, year, selectedCountries, selectedContinents) {
  let yearRows = rows.filter(
    (r) => Number(r.Year) === Number(year) && r["Country Name"] && Number(r.GDP) > 0
  );

  // allow for filtering by country/continent
  if (selectedCountries.size > 0) {
    yearRows = yearRows.filter(r => selectedCountries.has(r["Country Name"]));
  }
  if (selectedContinents.size > 0) {
    yearRows = yearRows.filter(r => selectedContinents.has(r["Continent Name"]));
  }
  
  // group by continent
  const byCont = d3.group(yearRows, (d) => d["Continent Name"] || "Unknown");
  const picked = [];

  // loop through continents and pick top 9 countries using GDP, group all others to Others
  for (const [cont, items] of byCont.entries()) {
    const sorted = items.slice().sort((a, b) => Number(b.GDP) - Number(a.GDP));
    const top = sorted.slice(0, TOP_9);
    const others = sorted.slice(TOP_9);
    picked.push(...top);
    if (others.length) {
      const othersGDP = d3.sum(others, (d) => Number(d.GDP) || 0);
      const avgUnemp = d3.mean(others, (d) => Number(d.Unemployment) || 0);
      const avgInfl = d3.mean(others, (d) => Number(d["Inflation Rate"]) || 0);
      picked.push({
        Year: year,
        "Country Name": `Others (${cont})`,
        "Continent Name": cont,
        GDP: othersGDP,
        Unemployment: avgUnemp,
        "Inflation Rate": avgInfl,
      });
    }
  }

  const children = picked.map((r) => {
    const country = {
      // MINOR MERGE CONFLICT WITH 'toFixed' (check later)
      name: r["Country Name"],
      continent: r["Continent Name"] || "Unknown",
      unemployment: Number(r.Unemployment).toFixed(0),
      inflation: Number(r["Inflation Rate"]).toFixed(0),
      service: Number(r["Service (% GDP)"]).toFixed(0),
      import: Number(r["Import (% GDP)"]).toFixed(0),
      export: Number(r["Export (% GDP)"]).toFixed(0),
      agriculture: Number(r["Agriculture (% GDP)"]).toFixed(0),
      industry: Number(r["Industry (% GDP)"]).toFixed(0),
      gpdpercapita: Number(r["GDP Per Capita"]).toFixed(2),
      education:Number(r["Education Expenditure"]).toFixed(0),
      health: Number(r["Health Expenditure"]).toFixed(0)
    };

    const makeup = calcMakeup(r);
    const entries = Object.entries(makeup).filter(([, pct]) => pct > 0.0001);
    if (entries.length > 0 && !country.name.startsWith("Others (")) {
      return {
        ...country,
        // no direct value; sum of components defines size == GDP
        children: entries.map(([label, pct]) => ({
          name: label,
          value: (Number(r.GDP) || 0) * (pct / 100),
        })),
      };
    } else {
      // Leaf with no subdivisions
      return {
        ...country,
        value: Number(r.GDP) || 0,
      };
    }
  });

  return { name: "World", children };
}

const VoronoiTreemap = () => {
  const [rows, setRows] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [yearBounds, setYearBounds] = useState([2000, 2022]);
  const [selectedYear, setSelectedYear] = useState(2000);
  const [displayMode, setDisplayMode] = useState("name"); // 'name' or 'makeup'
  const [selectedCountries, setSelectedCountries] = useState(new Set());
  const [selectedContinents, setSelectedContinents] = useState(new Set());
  const [expandedContinents, setExpandedContinents] = useState(new Set());

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
    setProcessing(true);
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
        setProcessing(false);
      },
      error: (err) => {
        console.error("CSV load error:", err);
        setProcessing(false);
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

  // Render Voronoi treemap
  useEffect(() => {
    const svgEl = d3.select(svgRef.current);
    svgEl.selectAll("*").remove();
    if (!hierarchyData) return;

    const { w, h } = dims;
    const svg = svgEl.attr("viewBox", `0 0 ${w} ${h}`);


    function seededRandom(seed) {
      let s = seed;
      return function() {
        s = Math.sin(s) * 10000;
        return s - Math.floor(s);
      };
    }

    
    // Build hierarchy and compute polygons
    const root = d3
      .hierarchy(hierarchyData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const vt = voronoiTreemap()
      .clip([
        [0, 0],
        [0, h],
        [w, h],
        [w, 0],
      ])
      .convergenceRatio(0.015)
      .maxIterationCount(80)
      .minWeightRatio(0.002)
      .prng(seededRandom(12345));

    vt(root);

    // COUNTRY GROUPS (depth === 1)
    const countries = root.children || [];
    const gCountries = svg.append("g").attr("class", "countries");

    countries.forEach((node) => {
      const country = node.data;
      const polygon = node.polygon;
      if (!polygon) return;

      const borderColor = getInflationColor(country.inflation);
      const area = Math.abs(d3.polygonArea(polygon));
      const centroid = d3.polygonCentroid(polygon);

      const g = gCountries.append("g").attr("class", "country");
      
      
     

      // Fill:
      if (displayMode === "name" || !(node.children && node.children.length)) {
        g.append("path")
          .attr("d", `M${polygon.join("L")}Z`)
          .attr("fill", continentColors[country.continent] || "#ccc")
          .attr("fill-opacity", getOpacity(country.unemployment))
          .attr("stroke", borderColor)
          .attr("stroke-width", 2)

          //checks if user hovers over a node in tree map if so display tool tip that was referebced in the toolTipRef along with various data
          .on("mouseover", (event)=>{ toolTipRef.current.html(`<strong>${node.data.name}</strong><br/>
                                                    GDP: $${numberConversion(node.value)}<br/>
                                                    GDP Per Capita: $${node.data.gpdpercapita ?? "N/A"}<br/>
                                                    Agriculture(% GDP): ${node.data.agriculture ?? "N/A"}%<br/>
                                                    Service(% GDP): ${node.data.service?? "N/A"}%<br/>
                                                    Industry(% GDP): ${node.data.industry?? "N/A"}%<br/>
                                                    Inflation Rate: ${node.data.inflation ?? "N/A"}%<br/>
                                                    Unemployment Rate: ${node.data.unemployment ?? "N/A"}%<br/>`)
           
          .style("opacity",1);   //make the tooltip visible                                       
          })
          .on("mousemove", (event)=>{ toolTipRef.current                               // moves tooltip with mouse so mouse doesnt obstruct it
                                      .style("left",event.pageX + 10 +"px")
                                      .style("top", event.pageY + 10 + "px");                                       
          })
          //once user stops hovering over node, make tool tip disappear
          .on("mouseleave", ()=>{
            toolTipRef.current.style("opacity", 0);
          });

      } else {
        // Sub-cells: depth === 2 (components)
        // Draw components first, then a thin outline for the country
        (node.children || []).forEach((compNode) => {
          const compPoly = compNode.polygon;
          if (!compPoly) return;
          g.append("path")
            .attr("d", `M${compPoly.join("L")}Z`)
            .attr("fill", gdpComponentColors[compNode.data.name] || "#ddd")
            .attr("opacity", getOpacity(country.unemployment))
            .attr("stroke", "rgba(0,0,0,0.05)")
            .attr("stroke-width", 1);
            
        });

        // Country outline on top
        g.append("path")
          .attr("d", `M${polygon.join("L")}Z`)
          .attr("fill", "none")
          .attr("stroke", borderColor)
          .attr("stroke-width", 2);
      }

      // Labels (country name + GDP) — size-aware to avoid clutter
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
            .text(
              (() => {
                const nodeValue = node.value || 0;
                const trillions = nodeValue / 1e12;
                return `$${trillions >= 0.1 ? trillions.toFixed(2) + "T" : (nodeValue / 1e9).toFixed(0) + "B"}`
              })()
            );
        }
      }
    });
  }, [hierarchyData, dims, displayMode, selectedYear]);

  return (

    <div className="w-full min-h-screen bg-white">
      <div className ="body">
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6 text-center">GDP Voronoi Treemap Visualization</h1>

        {/* Controls */}
        <div className="bg-gray-100 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            {/* Year Slider */}
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

            {/* Display Mode */}
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
          </div>

          {/* Hierarchical Country and Continent Selection */}
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
                      
                      {/* Countries List */}
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


        {/* Legend */}
        <div className="bg-gray-100 rounded-lg p-4 mb-6">
          <h3 className="font-bold mb-3">Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><strong>Size:</strong> GDP (area)</div>
            <div><strong>Opacity:</strong> Employment rate</div>
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

        {/* Load the treemap chart */}
        <div ref={wrapperRef} className="w-full bg-white">
          <svg ref={svgRef} className="w-full h-auto block" />
        </div>

        {processing && (
          <div className="text-center py-6 text-gray-600">Processing data…</div>
        )}
      </div>
      </div>
    </div>
  );
};

export default VoronoiTreemap;
