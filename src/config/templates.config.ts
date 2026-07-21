export interface PostTemplateConfig {
  id: string;
  title: string;
  description: string;
  basePrompt: string;
}

export interface BusinessCategoryConfig {
  id: string;
  name: string;
  templates: PostTemplateConfig[];
}

export const BUSINESS_CATEGORIES: BusinessCategoryConfig[] = [
  {
    id: "moda",
    name: "Moda / Vestuário",
    templates: [
      {
        id: "dark-fashion",
        title: "Dark Fashion",
        description: "Cinematográfico, sofisticado e premium com tons escuros",
        basePrompt: "Crie um post comercial inspirado em campanhas premium de moda masculina e urbana. Iluminação cinematográfica, fundos escuros, pretos e grafites sofisticados. Tipografia grande e marcante.",
      },
      {
        id: "streetwear",
        title: "Streetwear",
        description: "Urbano, dinâmico e vibrante",
        basePrompt: "Crie um post de moda streetwear com visual urbano, composição dinâmica, formas geométricas arrojadas e alto impacto visual.",
      },
      {
        id: "fashion",
        title: "Fashion",
        description: "Elegante, clean e ideal para lojas de roupas e acessórios",
        basePrompt: "Crie um post comercial sofisticado para uma marca de moda. O produto deve ser o protagonista. Layout minimalista inspirado em Zara, COS e Uniqlo.",
      },
      {
        id: "fashion-editorial-slant",
        title: "Moda Editorial",
        description: "Estilo editorial com fotos sobrepostas e tipografia minimalista",
        basePrompt: "Crie um post em estilo editorial de moda e vestuário com composição assimétrica em duas colunas, sobreposição dinâmica de fotografias e foco em tipografia minimalista.",
      },
      {
        id: "luxury-single-oval-light",
        title: "Boutique Luxo",
        description: "Design minimalista e luminoso com moldura oval e detalhes sofisticados",
        basePrompt: "Crie um post minimalista para boutique e moda de alto padrão com fundo off-white/creme, moldura oval elegante e tipografia sofisticada.",
      },
      {
        id: "fashion-duo-spotlight-light",
        title: "Promoção da Semana - Destaque Duplo",
        description: "Layout vertical leve com dois quadros ovais e destaques de ofertas",
        basePrompt: "Crie um post promocional de moda com fundo creme claro, padrão geométrico sutil e duas fotos ovais de produtos lado a lado com cartões de preços.",
      },
      {
        id: "promo-grid-lace-header",
        title: "Mosaico Promocional",
        description: "Layout promocional marcante com fundo vibrante e cards de produtos",
        basePrompt: "Crie um post promocional de alto impacto com fundo rosa/carmim escuro, padrão de renda no topo e dois cards brancos de produto com preços.",
      },
      {
        id: "promo-grid",
        title: "Promoção em Grid",
        description: "Mosaico moderno para destacar promoções de vários produtos",
        basePrompt: "Crie um post promocional em mosaico (grid) com blocos bem definidos, excelente contraste, preço em destaque e estética de e-commerce de moda.",
      },
      {
        id: "fashion-combo-pinwheel",
        title: "Varejo Moda - Combo",
        description: "Layout dinâmico com arcos curvos e cabides sobrepostos",
        basePrompt: "Crie um post moderno focado na montagem de combos de looks de moda, exibindo produtos pendurados em cabides com fundo gráfico curvo.",
      },
      {
        id: "fashion-botanical-discount",
        title: "Moda Botânica",
        description: "Estética leve e natural com ilustrações botânicas e destaque na promoção",
        basePrompt: "Crie um post minimalista de moda com ilustrações botânicas delicadas em line art, fundo creme/areia e chamada promocional em destaque.",
      },
      {
        id: "oferta-unica",
        title: "Oferta Única",
        description: "Tipografia gigante e alto impacto promocional",
        basePrompt: "Crie um post publicitário de oferta com tipografia gigante (oversized) integrada ao produto, alto contraste visual e fundo minimalista.",
      },
      {
        id: "kids",
        title: "Kids Fashion",
        description: "Colorido, delicado e ideal para produtos infantis",
        basePrompt: "Crie um post comercial delicado e divertido para produtos infantis com formas orgânicas arredondadas, paleta pastel e tipografia amigável.",
      },
      {
        id: "kids-promo",
        title: "Kids Promo",
        description: "Promoções alegres para lojas de moda infantil",
        basePrompt: "Crie um post promocional para moda infantil com ambiente colorido, alegre e organizado, com desconto altamente destacado.",
      },
      {
        id: "dia-das-criancas",
        title: "Dia das Crianças",
        description: "Campanha especial de data comemorativa para público infantil",
        basePrompt: "Crie um post comercial alegre para campanha de Dia das Crianças, destacando o produto e o tema festivo de forma profissional.",
      },
      {
        id: "dia-dos-pais",
        title: "Dia dos Pais",
        description: "Campanha promocional elegante para Dia dos Pais",
        basePrompt: "Crie um post comercial para campanha especial de Dia dos Pais com composição elegante, tons azuis/bege e destaque para o presente ideal.",
      },
    ],
  },
  {
    id: "gastronomia",
    name: "Gastronomia / Alimentação",
    templates: [
      {
        id: "food-promo",
        title: "Food Promo",
        description: "Vibrante, apetitoso e de alto apelo visual para gastronomia",
        basePrompt: "Crie um post comercial apetitoso e vibrante para gastronomia. Fundo escuro texturizado, iluminação gastronômica de estúdio e texto da oferta em destaque.",
      },
      {
        id: "retail-bakery-offers",
        title: "Encarte de Ofertas",
        description: "Layout de encarte promocional moderno para produtos alimentícios",
        basePrompt: "Crie um layout promocional estilo encarte comercial elegante para confeitaria/padaria com cards brancos e destaque promocional.",
      },
      {
        id: "bakery-spotlight",
        title: "Padaria Artesanal",
        description: "Acolhedor com tons quentes e textura rústica artesanal",
        basePrompt: "Crie um post acolhedor para produtos artesanais e padaria com fundo de madeira nobre, iluminação quente e tipografia rústica elegante.",
      },
      {
        id: "bakery-red-impact",
        title: "Impacto Vermelho",
        description: "Alto contraste promocional com fundo vermelho vibrante",
        basePrompt: "Crie um post de alto impacto promocional com fundo vermelho escuro e destaque em blocos para ofertas irresistíveis.",
      },
      {
        id: "bakery-split-diagonal",
        title: "Divisão Diagonal",
        description: "Corte diagonal moderno dividindo imagem e informações comerciais",
        basePrompt: "Crie um post promocional com corte gráfico diagonal dividindo a foto do prato/produto e as informações de preço.",
      },
    ],
  },
  {
    id: "promocao",
    name: "Promoção / Varejo",
    templates: [
      {
        id: "quick-offer",
        title: "Oferta Rápida",
        description: "Layout limpo e direto para vendas rápidas no varejo",
        basePrompt: "Crie um post de oferta rápida e direta com visual limpo, gradiente suave de fundo e preço em grande destaque.",
      },
      {
        id: "grocery-tabloid-grid",
        title: "Encarte Digital",
        description: "Tabloide digital rico em informações para encartes de supermercado e varejo",
        basePrompt: "Crie um encarte digital estilo tabloide de ofertas com cabeçalho promocional forte e blocos organizados de produtos.",
      },
      {
        id: "retail-impact",
        title: "Impacto Comercial",
        description: "Design promocional arrojado com alto dinamismo visual",
        basePrompt: "Crie um post de alto impacto comercial com cores vibrantes, elementos em 3D discretos e preço em destaque máximo.",
      },
      {
        id: "grocery-color-block-spotlight",
        title: "Hortifruti",
        description: "Color block vibrante ideal para feira, hortifruti e produtos frescos",
        basePrompt: "Crie um post vibrante para hortifruti e produtos frescos com fundo de blocos de cor (color block) e tipografia promocional limpa.",
      },
      {
        id: "flash-offer-carnivora",
        title: "Oferta Relâmpago",
        description: "Design promocional urgente para ofertas com tempo limitado",
        basePrompt: "Crie um post promocional com aviso de Oferta Relâmpago, contador/cronômetro promocional e selo de urgência.",
      },
    ],
  },
  // {
  //   id: "beleza",
  //   name: "Beleza / Cosméticos",
  //   templates: [
  //     {
  //       id: "estetica-spa",
  //       title: "Estética & Spa",
  //       description: "Suave, relaxante e clean",
  //       basePrompt: "Crie um post para clínica de estética ou spa com tons pastéis, folhagens suaves, iluminação limpa e atmosfera relaxante.",
  //     },
  //     {
  //       id: "cosmeticos-boutique",
  //       title: "Cosméticos & Perfumaria",
  //       description: "Elegante e luxuoso",
  //       basePrompt: "Crie uma arte para cosméticos/perfumaria com reflexos de água/estúdio, frasco em destaque, pedras ou minerais sutis e acabamento premium.",
  //     },
  //   ],
  // },
  // {
  //   id: "geral",
  //   name: "Geral / Serviços",
  //   templates: [
  //     {
  //       id: "minimalista",
  //       title: "Minimalista",
  //       description: "Foco absoluto no produto com fundo neutro",
  //       basePrompt: "Crie um design minimalista limpo com bastante espaço negativo, fundo neutro, poucos elementos e foco absoluto no produto.",
  //     },
  //     {
  //       id: "moderno",
  //       title: "Moderno",
  //       description: "Formas geométricas e dinamismo",
  //       basePrompt: "Crie um layout contemporâneo com formas geométricas limpas, contraste profissional e apresentação versátil.",
  //     },
  //     {
  //       id: "elegante",
  //       title: "Elegante Premium",
  //       description: "Dark mode sofisticado",
  //       basePrompt: "Crie um layout escuro elegante com iluminação de destaque dramática e elementos discretos de alto luxo.",
  //     },
  //   ],
  // },
];

export function findCategoryByIndexOrId(input: string): BusinessCategoryConfig | undefined {
  const index = parseInt(input, 10) - 1;
  if (!isNaN(index) && index >= 0 && index < BUSINESS_CATEGORIES.length) {
    return BUSINESS_CATEGORIES[index];
  }
  const cleanInput = input.trim().toLowerCase();
  return BUSINESS_CATEGORIES.find(
    (c) => c.id.toLowerCase() === cleanInput || c.name.toLowerCase().includes(cleanInput)
  );
}

export function findTemplateByIndexOrId(
  category: BusinessCategoryConfig,
  input: string
): PostTemplateConfig | undefined {
  const index = parseInt(input, 10) - 1;
  if (!isNaN(index) && index >= 0 && index < category.templates.length) {
    return category.templates[index];
  }
  const cleanInput = input.trim().toLowerCase();
  
  // 1. Busca por ID exato
  const exactById = category.templates.find((t) => t.id.toLowerCase() === cleanInput);
  if (exactById) return exactById;

  // 2. Busca por título exato
  const exactByTitle = category.templates.find((t) => t.title.toLowerCase() === cleanInput);
  if (exactByTitle) return exactByTitle;

  // 3. Fallback de correspondência parcial
  return category.templates.find(
    (t) => t.title.toLowerCase().includes(cleanInput)
  );
}

export const DEFAULT_CATEGORY: BusinessCategoryConfig = BUSINESS_CATEGORIES[0]!;

export function getCategoryOrDefault(input?: string | null): BusinessCategoryConfig {
  if (!input) return DEFAULT_CATEGORY;
  return findCategoryByIndexOrId(input) ?? DEFAULT_CATEGORY;
}

export function getTemplateOrDefault(
  category: BusinessCategoryConfig,
  input?: string | null
): PostTemplateConfig {
  if (!input) return category.templates[0]!;
  return findTemplateByIndexOrId(category, input) ?? category.templates[0]!;
}
