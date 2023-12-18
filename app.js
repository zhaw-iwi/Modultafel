/**
 * @fileoverview This file contains the implementation of an Express server that handles file uploads and renders Svelte templates.
 * @module app
 * @requires express
 * @requires express-fileupload
 * @requires xlsx
 * @requires fs
 */
// Imports
const express = require("express");
const fileUpload = require("express-fileupload");
const app = express();
const PORT = process.env.PORT || 8080;
const xlsx = require("xlsx");
const fs = require("fs");

//const {add} = require("nodemon/lib/rules");

const TEMP_DIR = "public/tmp/";

// Provides static resources for the frontend & file upload
app.use(
  express.static("public"),
  fileUpload({
    useTempFiles: true,
    tempFileDir: TEMP_DIR,
  })
);

app.set("view engine", "ejs");

app.post("/upload", async function (req, res) {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("No files were uploaded.");
  }

  const excelFile = req.files.excelFile;
  const uploadPath = TEMP_DIR + Date.now() + "_" + excelFile.name;

  try {
    await excelFile.mv(uploadPath);
    const workbook = xlsx.readFile(uploadPath); // parse excel file
    const [settings, modules, wahlmodule] = workbook.SheetNames.map((name) =>
      xlsx.utils.sheet_to_json(workbook.Sheets[name])
    );

    const settingsMap = new Map(settings.map((s) => [s.Modulgruppe, s]));
    const electiveModulesMap = new Map(
      wahlmodule.map((m) => [m.Modulkuerzel, m])
    );
    const semesterMap = new Map();

    const information = settings.map((row) => ({
      title: row.Titel,
      subtitle: row.Subtitel,
      infoHead: row.InfoTextOben,
      warningFoot: row.WarningTextOben,
      infoFoot: row.InfoTextUnten,
    }))[0]; // Take the first object from the array

    modules.forEach((module) => {
      const setting = settingsMap.get(module.Modulgruppe);
      Object.assign(module, {
        Hintergrundfarbe: setting.Hintergrundfarbe,
        Schriftfarbe: setting.Schriftfarbe,
        is_elective: !!module.Wahlpflichtmodul,
      });

      const semester = semesterMap.get(module.Semester) || [];
      semester.push(module);
      semesterMap.set(module.Semester, semester);
    });

    let all = Array.from(semesterMap.keys())
      .sort((a, b) => {
        // Split semester strings and parse them as integers for comparison
        const semesterA = parseInt(a.split(".")[0], 10);
        const semesterB = parseInt(b.split(".")[0], 10);

        // Sort in descending order
        return semesterB - semesterA;
      })
      .map((semesterNumber) => ({
        number: semesterNumber.split(".")[0],
        semesterModules: transformModulesForSemester(
          semesterMap.get(semesterNumber),
          electiveModulesMap,
          settingsMap
        ),
      }));

    // Define the calculateTotalCredits function
    function calculateTotalCredits(semester) {
      let totalCredits = 0;
      semester.semesterModules.forEach((group) => {
        group.modules.forEach((module) => {
          totalCredits += parseInt(module.credits, 10);
        });
      });
      return totalCredits;
    }

    // Inside your /upload route handler, before rendering the App template:
    all = all.map((semester) => {
      return {
        ...semester,
        totalCredits: calculateTotalCredits(semester), // Add totalCredits to each semester object
      };
    });

    let uniqueGroups = {};

    all.forEach((semester) => {
      semester.semesterModules.forEach((module) => {
        const group = module.group;
        const color = module.color;
        const font = module.font; 

        if (!uniqueGroups[group]) {
          uniqueGroups[group] = { group, color, font };
        }
      });
    });

    let groupsArray = Object.values(uniqueGroups);

    const returnFile = TEMP_DIR + Date.now() + "_" + "Modultafel.html";

    res.render(
      "App",
      { all: all, information: information, groupsArray: groupsArray },
      (err, html) => {
        if (err) {
          console.error("Render error:", err);
          return res
            .status(500)
            .send(err.message || "Error rendering the view");
        }
        if (!html) {
          return res.status(500).send("Rendered HTML is undefined");
        }

        console.log("Rendered HTML:", html); // Debug: Inspect the rendered HTML

        fs.writeFile(returnFile, html, (err) => {
          if (err) {
            console.error("File write error:", err);
            return res.status(500).send(err.message || "Error writing to file");
          }
          res.download(returnFile);
        });
      }
    );
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).send(err);
  }
});

function transformModulesForSemester(
  modulesInSemester,
  electiveModulesMap,
  settingsMap
) {
  // Initialize groupModulesMap with all valid groups from settingsMap
  const groupModulesMap = new Map();
  settingsMap.forEach((setting, groupName) => {
    if (groupName) {
      // Check if groupName is defined
      groupModulesMap.set(groupName, {
        group: groupName,
        color: setting.Hintergrundfarbe,
        font: setting.Schriftfarbe,
        modules: [],
      });
    }
  });

  // Populate the groupModulesMap with modules
  modulesInSemester.forEach((module) => {
    if (groupModulesMap.has(module.Modulgruppe)) {
      const group = groupModulesMap.get(module.Modulgruppe);
      group.modules.push(createModuleObject(module, electiveModulesMap));
    }
  });

  return Array.from(groupModulesMap.values());
}

/**
 * Creates a module object based on the provided module data and elective modules map.
 * @param {Object} module - The module data.
 * @param {Map} electiveModulesMap - The map of elective modules.
 * @returns {Object} - The created module object.
 */
function createModuleObject(module, electiveModulesMap) {
  let electiveModules = [];
  if (module.is_elective && module.Wahlpflichtmodul) {
    electiveModules = module.Wahlpflichtmodul.split(",")
      .map((shortname) => {
        const electiveModule = electiveModulesMap.get(shortname.trim());
        return electiveModule
          ? {
              name: electiveModule.Modulbezeichnung,
              shortname: electiveModule.Modulkuerzel,
              description: electiveModule.Beschreibung,
              url: electiveModule.Link,
            }
          : null;
      })
      .filter((e) => e !== null); // Ensure to filter out any null entries
  }

  return {
    name: module.Modulbezeichnung,
    shortname: module.Modulkuerzel,
    description: module.Modulbeschreibung,
    credits: module.ECTS,
    url: module.Link,
    is_elective: module.is_elective,
    wahlmodule: electiveModules,
  };
}

app.listen(PORT, () => console.log("Server running on port " + PORT));
