export const TARGET_ROLE_CLUSTERS = [
  {
    cluster: "Strategy & Transformation",
    note: "Closest to the risk enabler to value creator pivot.",
    roles: [
      {
        targetRole: "Strategy & Transformation Manager",
        searchTerms: ["Strategy Transformation Manager", "Business Transformation Manager"],
      },
      {
        targetRole: "Strategy & Operations Manager",
        searchTerms: ["Strategy Operations Manager", "BizOps Manager"],
      },
      {
        targetRole: "Transformation Consultant / Manager",
        searchTerms: ["Digital Transformation Manager", "Business Transformation Consultant"],
      },
      {
        targetRole: "Technology Strategy Consultant",
        searchTerms: ["Technology Strategy Manager", "Tech Strategy Consultant"],
      },
      {
        targetRole: "Operating Model / TOM Consultant",
        searchTerms: ["Target Operating Model Consultant", "Operating Model Manager"],
      },
      {
        targetRole: "M&A Technology Advisory Manager",
        searchTerms: ["Technology M&A Manager", "Technology Due Diligence Manager"],
      },
      {
        targetRole: "Innovation Strategy Consultant",
        searchTerms: ["Innovation Strategy Manager", "Digital Strategy Consultant"],
      },
    ],
  },
  {
    cluster: "Programme / Delivery / PMO Leadership",
    note: "Versatile route combining delivery, MBA, transformation work, and risk foundation.",
    roles: [
      {
        targetRole: "Programme Manager",
        searchTerms: ["Programme Manager", "Program Manager"],
      },
      {
        targetRole: "Digital Transformation Programme Manager",
        searchTerms: ["Digital Programme Manager", "Transformation Programme Manager"],
      },
      {
        targetRole: "Technology Programme Manager",
        searchTerms: ["Tech Programme Manager", "IT Programme Manager"],
      },
      {
        targetRole: "Business Change Manager",
        searchTerms: ["Change Delivery Manager", "Business Change Lead"],
      },
      {
        targetRole: "Portfolio Delivery Lead",
        searchTerms: ["Portfolio Manager", "Portfolio Delivery Manager"],
      },
      {
        targetRole: "PMO Lead / PMO Manager",
        searchTerms: ["Transformation PMO", "Enterprise PMO"],
      },
      {
        targetRole: "Project Delivery Manager",
        searchTerms: ["Delivery Manager", "Senior Project Manager"],
      },
    ],
  },
  {
    cluster: "AI Governance / Responsible AI / Digital Trust",
    note: "Specialist wedge, especially with ISO/IEC 42001 positioning.",
    roles: [
      {
        targetRole: "AI Governance Manager",
        searchTerms: ["AI Governance Lead", "AI Governance Consultant"],
      },
      {
        targetRole: "Responsible AI Manager",
        searchTerms: ["Responsible AI Lead", "Responsible AI Consultant"],
      },
      {
        targetRole: "AI Risk Manager",
        searchTerms: ["AI Risk Lead", "AI Risk & Controls Manager"],
      },
      {
        targetRole: "AI Assurance Manager",
        searchTerms: ["Algorithm Assurance Manager", "AI Assurance Consultant"],
      },
      {
        targetRole: "AI Compliance Manager",
        searchTerms: ["AI Policy Manager", "AI Regulatory Compliance Manager"],
      },
      {
        targetRole: "Model Risk / AI Risk Governance",
        searchTerms: ["Model Risk Manager", "AI Model Governance"],
      },
      {
        targetRole: "Digital Trust & AI Governance Manager",
        searchTerms: ["Digital Trust Manager", "AI Trust & Safety Governance"],
      },
    ],
  },
  {
    cluster: "Product / Data / Digital Operating Model",
    note: "Business and product-adjacent track to target selectively.",
    roles: [
      {
        targetRole: "Product Operations Manager",
        searchTerms: ["Product Ops Manager", "Product Strategy Operations"],
      },
      {
        targetRole: "Product Owner",
        searchTerms: ["Digital Product Owner", "Technical Product Owner"],
      },
      {
        targetRole: "Product Transformation Manager",
        searchTerms: ["Product Operating Model Manager"],
      },
      {
        targetRole: "Data & AI Strategy Consultant",
        searchTerms: ["Data Strategy Consultant", "AI Strategy Consultant"],
      },
      {
        targetRole: "Digital Product Governance Manager",
        searchTerms: ["Product Risk Manager", "Product Compliance Manager"],
      },
      {
        targetRole: "IT Business Partner",
        searchTerms: ["Technology Business Partner", "Digital Business Partner"],
      },
    ],
  },
];

export function flattenTargetRoles() {
  return TARGET_ROLE_CLUSTERS.flatMap((cluster) =>
    cluster.roles.map((role) => ({
      ...role,
      cluster: cluster.cluster,
      clusterNote: cluster.note,
      query: role.targetRole,
    })),
  );
}
