-- =============================================================================
-- Line-item descriptions.
-- Adds a pre-written description to each line-item template. When a line item
-- is chosen in the estimate builder, this text is loaded into a rich-text
-- editor that staff can edit per estimate. Defaults below are starting points
-- and can be edited any time.
-- =============================================================================

alter table public.line_items add column if not exists description text;

update public.line_items set description = '<p>All interior surfaces prepared to a professional standard: filling minor cracks and holes, sanding, spot-priming bare areas, and protecting floors, fixtures and furniture with drop sheets and masking.</p>' where name = 'Interior Preparation';
update public.line_items set description = '<p>Application of premium interior paint to the nominated surfaces, cut in and rolled or brushed to a smooth, even finish in the agreed colour(s) and sheen.</p>' where name = 'Interior Paintwork';
update public.line_items set description = '<p>Walls and ceilings prepared and finished with premium interior paint, cut in and rolled to an even, consistent finish in the agreed colour(s).</p>' where name = 'Interior Paintwork - Walls and Ceilings';
update public.line_items set description = '<p>Exterior surfaces prepared for painting: pressure washing, scraping loose or flaking paint, sanding, filling and priming bare or exposed areas, and protecting surrounding surfaces and landscaping.</p>' where name = 'Exterior Preparation';
update public.line_items set description = '<p>Application of premium exterior paint to the nominated surfaces, applied to the manufacturer''s specification for long-lasting weather protection and finish.</p>' where name = 'Exterior Paint Application';
update public.line_items set description = '<p>Supply and application of CUTEK oil to timber, penetrating to protect the timber and enhance its natural grain.</p>' where name = 'Cutek';
update public.line_items set description = '<p>Repair of damaged plaster: patching, setting and sanding back to a smooth finish ready for painting.</p>' where name = 'Plaster Repair';
update public.line_items set description = '<p>Roof cleaned and resprayed: surface prepared, primed where required, and finished with a roof-grade coating in the agreed colour.</p>' where name = 'Roof Respray';
update public.line_items set description = '<p>Hire of a scissor lift to safely access high areas for the duration of the works.</p>' where name = 'Scissor Lift Hire';
update public.line_items set description = '<p>Hire of a boom lift to safely access high or hard-to-reach areas for the duration of the works.</p>' where name = 'Boom Lift Hire';
update public.line_items set description = '<p>Supply, erection and dismantling of scaffolding to provide safe access for the works.</p>' where name = 'Scaffolding';
update public.line_items set description = '<p>Final clean of the work area on completion: removal of masking and drop sheets, and tidy-up of all painted areas.</p>' where name = 'Cleaning';
