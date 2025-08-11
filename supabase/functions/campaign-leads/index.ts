// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const getUserId = async (req: Request, supabase: SupabaseClient) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Authorization header is required");
  }
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw new Error("Invalid or expired token");
  }

  return user.id;
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    "https://lkkwcjhlkxqttcqrcfpm.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra3djamhsa3hxdHRjcXJjZnBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTMxMzE5OCwiZXhwIjoyMDYwODg5MTk4fQ.e8SijEhKnoa1R8dYzPBeKcgsEjKtXb9_Gd1uYg6AhuA"
  );

  const userId = await getUserId(req, supabase);
  const { campaign_id, target_audiences } = await req.json();

  const { data: campaignData, error: campaignError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaign_id)
    .eq("user_id", userId)
    .single();

  if (campaignError) {
    return new Response(JSON.stringify({ error: campaignError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const generectApiKey = "9923f958608bb3dd9e446506c6213706b46de708";
  const generectUrl = "https://api.generect.com/api/linkedin/leads/by_icp/";
  const generectHeaders = {
    "Content-Type": "application/json",
    Authorization: `Token ${generectApiKey}`,
  };

  const industryList = [
    {
      parent: "Accommodation and Food Services",
      children: [
        "Accommodation and Food Services",
        "Food and Beverage Services",
        "Bars, Taverns, and Nightclubs",
        "Caterers",
        "Mobile Food Services",
        "Restaurants",
        "Hospitality",
        "Bed-and-Breakfasts, Hostels, Homestays",
        "Hotels and Motels",
        "Administrative and Support Services",
        "Collection Agencies",
        "Events Services",
        "Facilities Services",
        "Janitorial Services",
        "Landscaping Services",
        "Fundraising",
        "Office Administration",
        "Security and Investigations",
        "Security Guards and Patrol Services",
        "Security Systems Services",
        "Staffing and Recruiting",
        "Executive Search Services",
        "Temporary Help Services",
        "Telephone Call Centers",
        "Translation and Localization",
        "Travel Arrangements",
        "Writing and Editing",
      ],
    },
    {
      parent: "Construction",
      children: [
        "Construction",
        "Building Construction",
        "Nonresidential Building Construction",
        "Residential Building Construction",
        "Civil Engineering",
        "Highway, Street, and Bridge Construction",
        "Subdivision of Land",
        "Utility System Construction",
        "Specialty Trade Contractors",
        "Building Equipment Contractors",
        "Building Finishing Contractors",
        "Building Structure and Exterior Contractors",
      ],
    },
    {
      parent: "Consumer Services",
      children: [
        "Consumer Services",
        "Civic and Social Organizations",
        "Industry Associations",
        "Political Organizations",
        "Professional Organizations",
        "Household Services",
        "Non-profit Organizations",
        "Personal and Laundry Services",
        "Laundry and Drycleaning Services",
        "Personal Care Services",
        "Pet Services",
        "Philanthropic Fundraising Services",
        "Religious Institutions",
        "Repair and Maintenance",
        "Commercial and Industrial Machinery Maintenance",
        "Electronic and Precision Equipment Maintenance",
        "Footwear and Leather Goods Repair",
        "Reupholstery and Furniture Repair",
        "Vehicle Repair and Maintenance",
      ],
    },
    {
      parent: "Education",
      children: [
        "Education",
        "Business Skills Training",
        "E-Learning Providers",
        "Higher Education",
        "Primary and Secondary Education",
        "Technical and Vocational Training",
        "Cosmetology and Barber Schools",
        "Fine Arts Schools",
        "Flight Training",
        "Language Schools",
        "Secretarial Schools",
        "Sports and Recreation Instruction",
      ],
    },
    {
      parent: "Entertainment Providers",
      children: [
        "Entertainment Providers",
        "Artists and Writers",
        "Museums, Historical Sites, and Zoos",
        "Historical Sites",
        "Museums",
        "Zoos and Botanical Gardens",
        "Musicians",
        "Performing Arts and Spectator Sports",
        "Circuses and Magic Shows",
        "Dance Companies",
        "Performing Arts",
        "Spectator Sports",
        "Racetracks",
        "Sports Teams and Clubs",
        "Theater Companies",
        "Recreational Facilities",
        "Amusement Parks and Arcades",
        "Gambling Facilities and Casinos",
        "Golf Courses and Country Clubs",
        "Skiing Facilities",
        "Wellness and Fitness Services",
      ],
    },
    {
      parent: "Farming, Ranching, Forestry",
      children: [
        "Farming, Ranching, Forestry",
        "Farming",
        "Horticulture",
        "Forestry and Logging",
        "Ranching and Fisheries",
        "Fisheries",
        "Ranching",
      ],
    },
    {
      parent: "Financial Services",
      children: [
        "Financial Services",
        "Capital Markets",
        "Investment Advice",
        "Investment Banking",
        "Investment Management",
        "Securities and Commodity Exchanges",
        "Venture Capital and Private Equity Principals",
        "Credit Intermediation",
        "Banking",
        "International Trade and Development",
        "Loan Brokers",
        "Savings Institutions",
        "Funds and Trusts",
        "Insurance and Employee Benefit Funds",
        "Pension Funds",
        "Trusts and Estates",
        "Insurance",
        "Claims Adjusting, Actuarial Services",
        "Insurance Agencies and Brokerages",
        "Insurance Carriers",
      ],
    },
    {
      parent: "Government Administration",
      children: [
        "Government Administration",
        "Administration of Justice",
        "Correctional Institutions",
        "Courts of Law",
        "Fire Protection",
        "Law Enforcement",
        "Public Safety",
        "Economic Programs",
        "Transportation Programs",
        "Utilities Administration",
        "Environmental Quality Programs",
        "Air, Water, and Waste Program Management",
        "Conservation Programs",
        "Health and Human Services",
        "Education Administration Programs",
        "Public Assistance Programs",
        "Public Health",
        "Housing and Community Development",
        "Community Development and Urban Planning",
        "Housing Programs",
        "Military and International Affairs",
        "Armed Forces",
        "International Affairs",
        "Public Policy Offices",
        "Executive Offices",
        "Legislative Offices",
        "Space Research and Technology",
      ],
    },
    {
      parent: "Holding Companies",
      children: ["Holding Companies"],
    },
    {
      parent: "Hospitals and Health Care",
      children: [
        "Hospitals and Health Care",
        "Community Services",
        "Services for the Elderly and Disabled",
        "Hospitals",
        "Individual and Family Services",
        "Child Day Care Services",
        "Emergency and Relief Services",
        "Vocational Rehabilitation Services",
        "Medical Practices",
        "Alternative Medicine",
        "Ambulance Services",
        "Chiropractors",
        "Dentists",
        "Family Planning Centers",
        "Home Health Care Services",
        "Medical and Diagnostic Laboratories",
        "Mental Health Care",
        "Optometrists",
        "Outpatient Care Centers",
        "Physical, Occupational and Speech Therapists",
        "Physicians",
        "Nursing Homes and Residential Care Facilities",
      ],
    },
    {
      parent: "Manufacturing",
      children: [
        "Manufacturing",
        "Apparel Manufacturing",
        "Fashion Accessories Manufacturing",
        "Appliances, Electrical, and Electronics Manufacturing",
        "Electric Lighting Equipment Manufacturing",
        "Electrical Equipment Manufacturing",
        "Household Appliance Manufacturing",
        "Chemical Manufacturing",
        "Agricultural Chemical Manufacturing",
        "Artificial Rubber and Synthetic Fiber Manufacturing",
        "Chemical Raw Materials Manufacturing",
        "Paint, Coating, and Adhesive Manufacturing",
        "Personal Care Product Manufacturing",
        "Pharmaceutical Manufacturing",
        "Soap and Cleaning Product Manufacturing",
        "Computers and Electronics Manufacturing",
        "Audio and Video Equipment Manufacturing",
        "Communications Equipment Manufacturing",
        "Computer Hardware Manufacturing",
        "Magnetic and Optical Media Manufacturing",
        "Measuring and Control Instrument Manufacturing",
        "Renewable Energy Semiconductor Manufacturing",
        "Semiconductor Manufacturing",
        "Fabricated Metal Products",
        "Architectural and Structural Metal Manufacturing",
        "Boilers, Tanks, and Shipping Container Manufacturing",
        "Construction Hardware Manufacturing",
        "Cutlery and Handtool Manufacturing",
        "Metal Treatments",
        "Metal Valve, Ball, and Roller Manufacturing",
        "Spring and Wire Product Manufacturing",
        "Turned Products and Fastener Manufacturing",
        "Food and Beverage Manufacturing",
        "Breweries",
        "Distilleries",
        "Wineries",
        "Animal Feed Manufacturing",
        "Baked Goods Manufacturing",
        "Beverage Manufacturing",
        "Dairy Product Manufacturing",
        "Fruit and Vegetable Preserves Manufacturing",
        "Meat Products Manufacturing",
        "Seafood Product Manufacturing",
        "Sugar and Confectionery Product Manufacturing",
        "Furniture and Home Furnishings Manufacturing",
        "Household and Institutional Furniture Manufacturing",
        "Mattress and Blinds Manufacturing",
        "Office Furniture and Fixtures Manufacturing",
        "Glass, Ceramics and Concrete Manufacturing",
        "Abrasives and Nonmetallic Minerals Manufacturing",
        "Clay and Refractory Products Manufacturing",
        "Glass Product Manufacturing",
        "Lime and Gypsum Products Manufacturing",
        "Leather Product Manufacturing",
        "Footwear Manufacturing",
        "Women's Handbag Manufacturing",
        "Machinery Manufacturing",
        "Agriculture, Construction, Mining Machinery Manufacturing",
        "Automation Machinery Manufacturing",
        "Commercial and Service Industry Machinery Manufacturing",
        "Engines and Power Transmission Equipment Manufacturing",
        "HVAC and Refrigeration Equipment Manufacturing",
        "Industrial Machinery Manufacturing",
        "Metalworking Machinery Manufacturing",
        "Medical Equipment Manufacturing",
        "Oil and Coal Product Manufacturing",
        "Paper and Forest Product Manufacturing",
        "Plastics and Rubber Product Manufacturing",
        "Packaging and Containers Manufacturing",
        "Plastics Manufacturing",
        "Rubber Products Manufacturing",
        "Primary Metal Manufacturing",
        "Printing Services",
        "Sporting Goods Manufacturing",
        "Textile Manufacturing",
        "Tobacco Manufacturing",
        "Transportation Equipment Manufacturing",
        "Aviation and Aerospace Component Manufacturing",
        "Defense and Space Manufacturing",
        "Motor Vehicle Manufacturing",
        "Motor Vehicle Parts Manufacturing",
        "Railroad Equipment Manufacturing",
        "Shipbuilding",
        "Wood Product Manufacturing",
      ],
    },
    {
      parent: "Oil, Gas, and Mining",
      children: [
        "Oil, Gas, and Mining",
        "Mining",
        "Coal Mining",
        "Metal Ore Mining",
        "Nonmetallic Mineral Mining",
        "Oil and Gas",
        "Natural Gas Extraction",
        "Oil Extraction",
      ],
    },
    {
      parent: "Professional Services",
      children: [
        "Professional Services",
        "Accounting",
        "Architecture and Planning",
        "Business Consulting and Services",
        "Advertising Services",
        "Environmental Services",
        "Human Resources Services",
        "Operations Consulting",
        "Outsourcing and Offshoring Consulting",
        "Strategic Management Services",
        "Design Services",
        "Graphic Design",
        "Interior Design",
        "IT Services and IT Consulting",
        "Computer and Network Security",
        "IT System Custom Software Development",
        "IT System Data Services",
        "IT System Design Services",
        "IT System Installation and Disposal",
        "IT System Operations and Maintenance",
        "IT System Testing and Evaluation",
        "IT System Training and Support",
        "Legal Services",
        "Alternative Dispute Resolution",
        "Law Practice",
        "Marketing Services",
        "Government Relations Services",
        "Market Research",
        "Public Relations and Communications Services",
        "Photography",
        "Research Services",
        "Biotechnology Research",
        "Nanotechnology Research",
        "Think Tanks",
        "Veterinary Services",
      ],
    },
    {
      parent: "Real Estate and Equipment Rental Services",
      children: [
        "Real Estate and Equipment Rental Services",
        "Equipment Rental Services",
        "Commercial and Industrial Equipment Rental",
        "Consumer Goods Rental",
        "Leasing Real Estate",
        "Leasing Non-residential Real Estate",
        "Leasing Real Estate Agents and Brokers",
        "Leasing Residential Real Estate",
      ],
    },
    {
      parent: "Retail",
      children: [
        "Retail",
        "Food and Beverage Retail",
        "Retail Groceries",
        "Online and Mail Order Retail",
        "Retail Apparel and Fashion",
        "Retail Appliances, Electrical, and Electronic Equipment",
        "Retail Art Supplies",
        "Retail Books and Printed News",
        "Retail Building Materials and Garden Equipment",
        "Retail Florists",
        "Retail Furniture and Home Furnishings",
        "Retail Gasoline",
        "Retail Health and Personal Care Products",
        "Retail Luxury Goods and Jewelry",
        "Retail Motor Vehicles",
        "Retail Musical Instruments",
        "Retail Office Equipment",
        "Retail Office Supplies and Gifts",
        "Retail Recyclable Materials & Used Merchandise",
      ],
    },
    {
      parent: "Technology, Information and Internet",
      children: [
        "Technology, Information and Internet",
        "Media and Telecommunications",
        "Book and Periodical Publishing",
        "Book Publishing",
        "Newspaper Publishing",
        "Periodical Publishing",
        "Broadcast Media Production and Distribution",
        "Cable and Satellite Programming",
        "Radio and Television Broadcasting",
        "Movie and Video Distribution",
        "Animation and Post-production",
        "Media Production",
        "Movies and Sound Recording",
        "Sheet Music Publishing",
        "Sound Recording",
        "Telecommunications",
        "Satellite Telecommunications",
        "Telecommunications Carriers",
        "Wireless Services",
        "Technology and Information",
        "Data Infrastructure and Analytics",
        "Blockchain Services",
        "Business Intelligence Platforms",
        "Information Services",
        "Internet Publishing",
        "Blogs",
        "Business Content",
        "Online Audio and Video Media",
        "Internet News",
        "Libraries",
        "Internet Marketplace Platforms",
        "Social Networking Platforms",
        "Software Development",
        "Computer Games",
        "Mobile Gaming Apps",
        "Computer Networking Products",
        "Data Security Software Products",
        "Desktop Computing Software Products",
        "Embedded Software Products",
        "Mobile Computing Software Products",
      ],
    },
    {
      parent: "Transportation, Logistics, Supply Chain and Storage",
      children: [
        "Transportation, Logistics, Supply Chain and Storage",
        "Airlines and Aviation",
        "Freight and Package Transportation",
        "Ground Passenger Transportation",
        "Interurban and Rural Bus Services",
        "School and Employee Bus Services",
        "Shuttles and Special Needs Transportation Services",
        "Sightseeing Transportation",
        "Taxi and Limousine Services",
        "Urban Transit Services",
        "Maritime Transportation",
        "Pipeline Transportation",
        "Postal Services",
        "Rail Transportation",
        "Truck Transportation",
        "Warehousing and Storage",
      ],
    },
    {
      parent: "Utilities",
      children: [
        "Utilities",
        "Electric Power Generation",
        "Biomass Electric Power Generation",
        "Fossil Fuel Electric Power Generation",
        "Geothermal Electric Power Generation",
        "Hydroelectric Power Generation",
        "Nuclear Electric Power Generation",
        "Solar Electric Power Generation",
        "Wind Electric Power Generation",
        "Electric Power Transmission, Control, and Distribution",
        "Natural Gas Distribution",
        "Water, Waste, Steam, and Air Conditioning Services",
        "Steam and Air-Conditioning Supply",
        "Waste Collection",
        "Waste Treatment and Disposal",
        "Water Supply and Irrigation Systems",
      ],
    },
    {
      parent: "Wholesale",
      children: [
        "Wholesale",
        "Wholesale Alcoholic Beverages",
        "Wholesale Apparel and Sewing Supplies",
        "Wholesale Appliances, Electrical, and Electronics",
        "Wholesale Building Materials",
        "Wholesale Chemical and Allied Products",
        "Wholesale Computer Equipment",
        "Wholesale Drugs and Sundries",
        "Wholesale Food and Beverage",
        "Wholesale Footwear",
        "Wholesale Furniture and Home Furnishings",
        "Wholesale Hardware, Plumbing, Heating Equipment",
        "Wholesale Import and Export",
        "Wholesale Luxury Goods and Jewelry",
        "Wholesale Machinery",
        "Wholesale Metals and Minerals",
        "Wholesale Motor Vehicles and Parts",
        "Wholesale Paper Products",
        "Wholesale Petroleum and Petroleum Products",
        "Wholesale Photography Equipment and Supplies",
        "Wholesale Raw Farm Products",
        "Wholesale Recyclable Materials",
      ],
    },
  ];

  const targetAudienceList = target_audiences.map((targetAudience) => {
    return {
      role: targetAudience.role_english,
      industry: targetAudience.industry_english,
      country: targetAudience.country_english,
    };
  });

  const prompt = `
    With the following different target audience contexts:
    ${targetAudienceList.map((targetAudience, index) => {
      return `
      ${index + 1}.
      Role: ${targetAudience.role}
      Industry: ${targetAudience.industry}
      Country: ${targetAudience.country}`;
    })}

    Industry List:
    ${industryList.map((industry, index) => {
      return `${index + 1}. Parent: ${
        industry.parent
      } - Children: ${industry.children.join(", ")}`;
    })}

    Tasks:
    - Generate a list of 4-5 words (one word per item) that are relevant to the role or industry for each target audience.
    - Generate a list of 4-5 words (one word per item) that are relevant to the desired seniority for each target audience.
    - Choose two child industry from the same parent from the industry list that are relevant to the target audiences industry.

    Keep the words simple and generic.
  
    Examples for the role or insudtry list are:
    "Chiefs": ["Digital", "Data", "Sales", "Strategy", "Executive"]
    "Sales or Data Managers/Directors": ["Sales", "Data"]
    "Founder and owners": ["Founder", "Co-Founder", "Owner", "Co-Owner", "President"]

    Examples for the seniority list are: 
    "Chiefs": ["Chief"]
    "Sales or Data Managers/Directors": ["Manager", "Director"]

    IMPORTANT: If the data provided is not in english, please return the data in english.
    IMPORTANT: Return the answers in the following JSON format for each target audience:
    [
      {
        "role": "actual target audience role",
        "industry": "actual target audience industry",
        "country": "actual target audience country",
        "roleList": [ "role 1", "role 2", "role 3" ],
        "seniorityList": [ "seniority 1", "seniority 2", "seniority 3" ],
        "recommendedIndustries": [ "industry 1", "industry 2"]
      }
    ]
  `;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a world class lead generation expert. You are given a target audience and you need to generate extra information for finding leads using generect leads api.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 1000,
  });

  console.log("Successfully analyzed content with OpenAI");
  const response = completion.choices[0].message.content;
  console.log("OpenAI response:", response);

  let cleanResponse = response.trim();
  if (cleanResponse.startsWith("```json")) {
    cleanResponse = cleanResponse
      .replace(/^```json\s*/, "")
      .replace(/\s*```$/, "");
  } else if (cleanResponse.startsWith("```")) {
    cleanResponse = cleanResponse.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  const parsedResponse = JSON.parse(cleanResponse);
  console.log("Role and seniority lists:", parsedResponse);

  // Lead Promises
  const leadsPromises = parsedResponse.map(async (targetAudience) => {
    const generectBody = {
      without_company: true,
      locations: [targetAudience.country],
      personas: [
        [
          targetAudience.role,
          [...targetAudience.roleList],
          [],
          [...targetAudience.seniorityList],
        ],
      ],
      industries: targetAudience.recommendedIndustries,
      limit_by: 100,
    };

    console.log("Generect body:", generectBody);

    const generectResponse = await fetch(generectUrl, {
      method: "POST",
      headers: generectHeaders,
      body: JSON.stringify(generectBody),
    });

    const generectData = await generectResponse.json();
    console.log("Generect data:", generectData);
    return {
      role: targetAudience.role,
      industry: targetAudience.industry,
      leads: generectData?.leads,
    };
  });

  const leadsData = await Promise.all(leadsPromises);

  const new_latest_step = 8;
  const cleanFurtherProgress = {};
  for (let x = new_latest_step + 1; x <= 10; x++) {
    const keyName = `step_${x}_result`;
    cleanFurtherProgress[keyName] = null;
  }

  const { error: updateError } = await supabase
    .from("campaign_progress")
    .update({
      latest_step: new_latest_step,
      step_8_result: leadsData,
      ...cleanFurtherProgress,
    })
    .eq("id", campaignData.progress_id);

  if (updateError) {
    console.error("Error updating campaign progress:", updateError);
    return new Response(JSON.stringify({ error: updateError.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  return new Response(
    JSON.stringify({
      message: "Campaign leads processed",
      data: {
        leads: leadsData,
        filters: [],
      },
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/campaign-leads' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
