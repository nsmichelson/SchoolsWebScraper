const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const schoolUrls = require('./schoolUrls.js');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const scrapeSchoolData = async (schoolUrls) => {
  console.log('Starting scraper...');
  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  const schools = [];

  try {
    await page.setViewport({ width: 1366, height: 768 });

    const totalSchools = Object.keys(schoolUrls).length;
    let currentSchool = 0;

    for (const [schoolName, url] of Object.entries(schoolUrls)) {
      try {
        currentSchool++;
        console.log(`\nProcessing school ${currentSchool}/${totalSchools}: ${schoolName}`);
        await page.goto(url);
        await delay(2000);

        // First get the basic school data
        let schoolData = await page.evaluate(() => {
          const data = {};
          data.name = document.querySelector('h1')?.textContent?.trim();
          
          const labelElements = document.querySelectorAll('.label, .flex.label');
          labelElements.forEach(labelElement => {
            const labelText = labelElement.textContent.replace(/\s*help$/, '').trim();
            const value = labelElement.nextElementSibling?.textContent.trim();
            
            if (labelText && value) {
              const cleanKey = labelText
                .replace(/%/g, 'Percent')
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_]/g, '');
              data[cleanKey] = value;
            }
          });

          const scoreElement = document.querySelector('.rating') || 
                             document.querySelector('[class*="score"]');
          const rankElement = document.querySelector('.rank');

          if (scoreElement) {
            data.score = scoreElement.textContent.trim();
          }
          
          if (rankElement) {
            data.rank = rankElement.textContent.trim().replace('help', '');
          }

          return data;
        });

        // Add the school name from our object
        schoolData.school_name = schoolName;

        // Click the Table tab
        console.log('Clicking Table tab...');
        await page.evaluate(() => {
          const tableTab = Array.from(document.querySelectorAll('button')).find(
            button => button.textContent.includes('Table')
          );
          if (tableTab) tableTab.click();
        });
        
        // Wait for table content to load
        console.log('Waiting for table content...');
        await delay(2000);

        // Get the academic performance data
        const academicData = await page.evaluate(() => {
          const data = {};
          const years = ['2022', '2021', '2020', '2019', '2018'];
          
          // Helper function to clean cell data
          const cleanCellData = (text) => text?.trim() || 'n/a';

          // Get all rows
          const rows = Array.from(document.querySelectorAll('table tr'));
          console.log(`Found ${rows.length} rows`);

          let currentPrefix = 'gr4';  // Default to grade 4
          
          // Process each row
          rows.forEach(row => {
            const rowText = row.textContent.trim().toLowerCase();  // Convert to lowercase for comparison
            
            // Check if this is a header row and update the prefix
            if (rowText.includes('gr 4') || rowText.includes('grade 4')) {
              currentPrefix = 'gr4';
              return;
            } else if (rowText.includes('gr 7 avg') || rowText.includes('grade 7 avg')) {
              currentPrefix = 'gr7';
              return;
            } else if (rowText.includes('gender gap')) {
              currentPrefix = 'gr7_gender_gap';
              return;
            }

            // Get the first cell (metric name)
            const cells = Array.from(row.querySelectorAll('td'));
            const firstCell = cells[0]?.textContent.trim();
            if (!firstCell) return;

            // Check if this is a metric row
            const metrics = [
              'Reading', 
              'Writing', 
              'Literacy', 
              'Numeracy',
              'Below expectations (%)',
              'Tests not written (%)',
              'Overall rating out of 10'
            ];

            // Clean up the firstCell text to handle the help text
            const cleanedFirstCell = firstCell.replace(/\s*help\s*$/, '');
            
            if (metrics.includes(cleanedFirstCell)) {
              const baseKey = cleanedFirstCell.toLowerCase()
                .replace(/[()%]/g, '')  // Remove special characters
                .replace(/\s+/g, '_');  // Replace spaces with underscores
              
              years.forEach((year, index) => {
                // Use a different key structure for the general metrics
                const key = cleanedFirstCell.includes('Below expectations') || 
                           cleanedFirstCell.includes('Tests not written') ||
                           cleanedFirstCell.includes('Overall rating') 
                  ? `${baseKey}_${year}`
                  : `${currentPrefix}_${baseKey}_${year}`;
                
                let value = cleanCellData(cells[index + 1]?.textContent);
                
                // Remove 'help' text if present in the value
                value = value.replace(/\s*help\s*/, '');
                
                data[key] = value;
              });
            }
          });

          return data;
        });

        console.log('Academic data:', academicData);

        // Merge the academic data with the school data
        schoolData = { ...schoolData, ...academicData };

        schools.push(schoolData);
        console.log(`Scraped: ${schoolName}`);
        console.log('Data:', schoolData);
        await delay(1000);
        
      } catch (error) {
        console.error(`Error with school ${schoolName}:`, error.message);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
    
    if (schools.length > 0) {
      // Ensure school_name is the first column
      const allKeys = Object.keys(schools[0]);
      const headerKeys = ['school_name', ...allKeys.filter(key => key !== 'school_name')];
      
      const csvWriter = createCsvWriter({
        path: 'school_details.csv',
        header: headerKeys.map(id => ({ id, title: id }))
      });
      await csvWriter.writeRecords(schools);
      console.log(`Saved ${schools.length} schools to school_details.csv`);
    } else {
      console.log('No schools were scraped');
    }
  }
};

// Run the school sscraper
scrapeSchoolData(schoolUrls);
