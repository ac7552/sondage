# Pages and API calls for a switched-off feature answer "not found", as if they
# weren't there. See app/models/feature.rb.
module FeatureGate
  extend ActiveSupport::Concern

  class_methods do
    def requires_feature(name, **options)
      prepend_before_action(**options) { head :not_found unless Feature.enabled?(name) }
    end
  end
end
